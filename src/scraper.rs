use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use playwright_rs::{
    GotoOptions, LaunchOptions, Playwright, WaitForOptions, WaitForState, WaitUntil,
};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use tracing::info;
use url::Url;

use crate::config::{AppConfig, GameConfig, normalize_game_name};

const CARD_SELECTOR: &str = "div[data-rank]";
const CHALLENGE_MARKERS: &[&str] = &[
    "captcha",
    "access denied",
    "checking your browser",
    "系統異常",
    "存取遭拒",
    "安全驗證",
    "請稍候",
    "請完成下列動作",
    "just a moment",
    "cf-chl",
];

const EXTRACT_CARDS_SCRIPT: &str = r#"() =>
    Array.from(document.querySelectorAll('div[data-rank]')).map((card) => ({
        rank: card.getAttribute('data-rank'),
        title: card.querySelector('a[href*="/B.php?bsn="] h3')?.textContent ?? null,
        popularity: card.querySelector('data.hidden[value]')?.getAttribute('value') ?? null
    }))"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RankingMetrics {
    pub game_name: String,
    pub rank: u32,
    pub popularity: u64,
    pub page: u32,
    pub source_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GameScrapeResult {
    pub game_name: String,
    pub metrics: Option<RankingMetrics>,
    pub failure_detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawCard {
    rank: Option<String>,
    title: Option<String>,
    popularity: Option<String>,
}

pub async fn scrape_rankings(config: &AppConfig) -> Result<Vec<GameScrapeResult>> {
    let playwright = Playwright::launch()
        .await
        .context("無法啟動 Playwright driver；請先執行 --install-browser")?;
    let launch_options = LaunchOptions::new()
        .headless(config.bahamut.headless)
        .timeout(config.bahamut.navigation_timeout_ms as f64);
    let browser_result = playwright
        .chromium()
        .launch_with_options(launch_options)
        .await;
    let browser = match browser_result {
        Ok(browser) => browser,
        Err(error) => {
            let _ = playwright.shutdown().await;
            return Err(error).context("無法啟動 Chromium；請先執行 --install-browser");
        }
    };

    let result = scrape_with_browser(config, &browser).await;
    let close_result = browser.close().await.context("關閉 Chromium 失敗");
    let shutdown_result = playwright
        .shutdown()
        .await
        .context("關閉 Playwright driver 失敗");

    match result {
        Ok(metrics) => {
            close_result?;
            shutdown_result?;
            Ok(metrics)
        }
        Err(error) => Err(error),
    }
}

async fn scrape_with_browser(
    config: &AppConfig,
    browser: &playwright_rs::Browser,
) -> Result<Vec<GameScrapeResult>> {
    let page = browser.new_page().await.context("無法建立瀏覽器頁面")?;
    let mut results = vec![None; config.games.len()];
    let mut failures = vec![None; config.games.len()];
    let active_count = config.active_games().count();

    for page_number in config.bahamut.start_page..=config.bahamut.end_page {
        let target_url = ranking_url(config, page_number)?;
        info!(page = page_number, url = %target_url, "讀取巴哈排行頁");

        let response = page
            .goto(
                target_url.as_str(),
                Some(
                    GotoOptions::new()
                        .timeout(Duration::from_millis(config.bahamut.navigation_timeout_ms))
                        .wait_until(WaitUntil::DomContentLoaded),
                ),
            )
            .await
            .with_context(|| format!("第 {page_number} 頁載入失敗：{target_url}"))?;

        if let Some(response) = response {
            let status = response.status();
            ensure!(
                status < 400 || status == 403,
                "巴哈排行頁回傳 HTTP {status}（page={page_number}）"
            );
        }

        validate_final_url(&page.url(), config, page_number)?;

        let cards = page.locator(CARD_SELECTOR).await;
        if let Err(wait_error) = cards
            .first()
            .wait_for(Some(
                WaitForOptions::builder()
                    .state(WaitForState::Attached)
                    .timeout(config.bahamut.navigation_timeout_ms as f64)
                    .build(),
            ))
            .await
        {
            detect_challenge(&page).await?;
            return Err(wait_error).context(format!(
                "第 {page_number} 頁找不到排行卡片選擇器 {CARD_SELECTOR}"
            ));
        }

        let raw_cards: Vec<RawCard> = page
            .evaluate::<(), Vec<RawCard>>(EXTRACT_CARDS_SCRIPT, None)
            .await
            .with_context(|| format!("第 {page_number} 頁 DOM 解析失敗"))?;
        ensure!(!raw_cards.is_empty(), "第 {page_number} 頁沒有排行資料");
        let complete_cards = raw_cards
            .iter()
            .filter(|card| card.rank.is_some() && card.title.is_some() && card.popularity.is_some())
            .count();
        ensure!(
            complete_cards == raw_cards.len(),
            "第 {page_number} 頁的巴哈 DOM 結構不完整（完整 {complete_cards}/{} 筆），請更新選擇器",
            raw_cards.len()
        );

        let source_url = page.url();
        record_page_matches(
            &raw_cards,
            &config.games,
            &mut results,
            &mut failures,
            page_number,
            &source_url,
        )?;
        let completed_count = config
            .games
            .iter()
            .enumerate()
            .filter(|(index, game)| {
                game.enabled && (results[*index].is_some() || failures[*index].is_some())
            })
            .count();
        if completed_count == active_count {
            break;
        }

        if page_number < config.bahamut.end_page && config.bahamut.page_delay_ms > 0 {
            sleep(Duration::from_millis(config.bahamut.page_delay_ms)).await;
        }
    }

    Ok(config
        .games
        .iter()
        .zip(results)
        .zip(failures)
        .filter(|((game, _), _)| game.enabled)
        .map(|((game, metrics), failure_detail)| GameScrapeResult {
            game_name: game.game_name.trim().to_owned(),
            metrics,
            failure_detail,
        })
        .collect())
}

fn record_page_matches(
    cards: &[RawCard],
    games: &[GameConfig],
    results: &mut [Option<RankingMetrics>],
    failures: &mut [Option<String>],
    page_number: u32,
    source_url: &str,
) -> Result<()> {
    ensure!(
        games.len() == results.len() && games.len() == failures.len(),
        "內部錯誤：遊戲設定與抓取結果數量不一致"
    );
    for ((game, result), failure) in games
        .iter()
        .zip(results.iter_mut())
        .zip(failures.iter_mut())
    {
        if !game.enabled || result.is_some() || failure.is_some() {
            continue;
        }
        let game_name = game.game_name.trim();
        match select_game(cards, game_name) {
            Ok(Some((rank, popularity))) => {
                *result = Some(RankingMetrics {
                    game_name: game_name.to_owned(),
                    rank,
                    popularity,
                    page: page_number,
                    source_url: source_url.to_owned(),
                });
            }
            Ok(None) => {}
            Err(error) => {
                *failure = Some(format!(
                    "遊戲「{game_name}」在 page={page_number} 的排行／人氣解析失敗：{error:#}"
                ));
            }
        }
    }
    Ok(())
}

fn ranking_url(config: &AppConfig, page_number: u32) -> Result<Url> {
    let mut url = Url::parse(config.bahamut.base_url.trim())?;
    url.set_fragment(None);
    url.query_pairs_mut()
        .clear()
        .append_pair("c", &config.bahamut.category.to_string())
        .append_pair("page", &page_number.to_string());
    Ok(url)
}

fn validate_final_url(value: &str, config: &AppConfig, expected_page: u32) -> Result<()> {
    let url = Url::parse(value).context("巴哈重新導向到無效網址")?;
    ensure!(
        url.scheme() == "https"
            && url.host_str() == Some("forum.gamer.com.tw")
            && url.port_or_known_default() == Some(443)
            && url.path() == "/",
        "巴哈頁面重新導向到未允許的網址：{value}"
    );
    let query = url.query_pairs().collect::<Vec<_>>();
    let category = config.bahamut.category.to_string();
    let page = expected_page.to_string();
    ensure!(
        query
            .iter()
            .any(|(key, value)| key == "c" && value == category.as_str()),
        "巴哈重新導向後的分類不是 c={}：{value}",
        config.bahamut.category
    );
    ensure!(
        query
            .iter()
            .any(|(key, value)| key == "page" && value == page.as_str()),
        "巴哈重新導向後的頁碼不是 page={expected_page}：{value}"
    );
    Ok(())
}

async fn detect_challenge(page: &playwright_rs::Page) -> Result<()> {
    let title = page.title().await.unwrap_or_default();
    let body_excerpt = page
        .evaluate::<(), String>(
            "() => (document.body?.innerText ?? '').slice(0, 2000)",
            None,
        )
        .await
        .unwrap_or_default();
    if is_challenge_text(&format!("{title}\n{body_excerpt}")) {
        bail!(
            "巴哈回傳安全驗證或存取限制頁；請降低掃描頻率，或將 bahamut.headless 改為 false 後重試"
        );
    }
    Ok(())
}

fn is_challenge_text(value: &str) -> bool {
    let haystack = value.to_lowercase();
    CHALLENGE_MARKERS
        .iter()
        .any(|marker| haystack.contains(marker))
}

fn select_game(cards: &[RawCard], game_name: &str) -> Result<Option<(u32, u64)>> {
    let target = normalize_game_name(game_name);
    let matches = cards
        .iter()
        .filter(|card| {
            card.title
                .as_deref()
                .is_some_and(|title| normalize_game_name(title) == target)
        })
        .collect::<Vec<_>>();

    if matches.len() > 1 {
        bail!("同一頁出現多筆完全相同的遊戲名稱：{game_name}");
    }
    let Some(card) = matches.first() else {
        return Ok(None);
    };

    let rank_text = card.rank.as_deref().context("目標遊戲缺少 data-rank")?;
    let rank = rank_text
        .parse::<u32>()
        .with_context(|| format!("無效排行數值：{rank_text}"))?;
    ensure!(rank > 0, "排行必須大於 0");

    let popularity_text = card
        .popularity
        .as_deref()
        .context("目標遊戲缺少人氣 value")?;
    let popularity = popularity_text
        .parse::<u64>()
        .with_context(|| format!("無效人氣數值：{popularity_text}"))?;

    Ok(Some((rank, popularity)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BahamutConfig, GameConfig, GmailNotificationsConfig};
    use std::path::PathBuf;

    fn game(name: &str) -> GameConfig {
        GameConfig {
            enabled: true,
            game_name: name.to_owned(),
            write_to_google_sheets: false,
            spreadsheet_id: String::new(),
            service_account_key_path: PathBuf::new(),
            worksheet_name: String::new(),
            timezone: "Asia/Taipei".to_owned(),
            first_data_row: 2,
            date_column: "A".to_owned(),
            rank_column: "B".to_owned(),
            popularity_column: "C".to_owned(),
            notification_recipients: Vec::new(),
        }
    }

    fn test_config() -> AppConfig {
        AppConfig {
            schema_version: 2,
            bahamut: BahamutConfig {
                base_url: "https://forum.gamer.com.tw/".to_owned(),
                category: 30,
                start_page: 1,
                end_page: 10,
                navigation_timeout_ms: 30_000,
                page_delay_ms: 0,
                headless: true,
            },
            gmail_notifications: GmailNotificationsConfig::default(),
            games: vec![game("夜鴉"), game("另一款遊戲")],
            loaded_from_legacy: false,
        }
    }

    fn card(title: &str, rank: &str, popularity: &str) -> RawCard {
        RawCard {
            rank: Some(rank.to_owned()),
            title: Some(title.to_owned()),
            popularity: Some(popularity.to_owned()),
        }
    }

    #[test]
    fn builds_expected_ranking_urls_and_rejects_redirects() {
        assert_eq!(
            ranking_url(&test_config(), 7).unwrap().as_str(),
            "https://forum.gamer.com.tw/?c=30&page=7"
        );
        let mut config = test_config();
        config.bahamut.category = 500;
        assert_eq!(
            ranking_url(&config, 7).unwrap().as_str(),
            "https://forum.gamer.com.tw/?c=500&page=7"
        );
        assert!(
            validate_final_url("https://forum.gamer.com.tw/?c=30&page=8", &test_config(), 7)
                .is_err()
        );
    }

    #[test]
    fn requires_one_normalized_exact_game_match() {
        let cards = vec![card("別的遊戲", "1", "100"), card(" 夜鴉 ", "42", "9876")];
        assert_eq!(select_game(&cards, "夜鴉").unwrap(), Some((42, 9876)));
        let cards = vec![card("夜鴉：續作", "42", "9876")];
        assert_eq!(select_game(&cards, "夜鴉").unwrap(), None);
        let cards = vec![card("夜鴉", "42", "1"), card("夜鴉", "43", "2")];
        assert!(select_game(&cards, "夜鴉").is_err());
    }

    #[test]
    fn records_results_in_config_order_and_isolates_game_failures() {
        let config = test_config();
        let cards = vec![
            card("夜鴉", "不是數字", "9876"),
            card("另一款遊戲", "8", "200"),
        ];
        let mut results = vec![None; config.games.len()];
        let mut failures = vec![None; config.games.len()];
        record_page_matches(
            &cards,
            &config.games,
            &mut results,
            &mut failures,
            2,
            "https://forum.gamer.com.tw/?c=30&page=2",
        )
        .unwrap();

        assert!(results[0].is_none());
        assert!(failures[0].as_deref().is_some_and(|detail| {
            detail.contains("夜鴉") && detail.contains("無效排行數值")
        }));
        assert_eq!(results[1].as_ref().map(|metrics| metrics.rank), Some(8));
        assert!(failures[1].is_none());

        let cards = vec![card("另一款遊戲", "8", "200"), card("夜鴉", "42", "9876")];
        let mut results = vec![None; config.games.len()];
        let mut failures = vec![None; config.games.len()];
        record_page_matches(
            &cards,
            &config.games,
            &mut results,
            &mut failures,
            2,
            "https://forum.gamer.com.tw/?c=30&page=2",
        )
        .unwrap();

        let names = results
            .into_iter()
            .flatten()
            .map(|metrics| metrics.game_name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["夜鴉", "另一款遊戲"]);
        assert!(failures.into_iter().all(|failure| failure.is_none()));
    }

    #[test]
    fn recognizes_challenge_pages() {
        assert!(is_challenge_text("Just a moment..."));
        assert!(is_challenge_text("請完成下列動作以繼續瀏覽"));
        assert!(!is_challenge_text("哈啦區 - 巴哈姆特"));
    }
}
