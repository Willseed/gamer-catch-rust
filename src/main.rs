use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use clap::Parser;
use gamer_catch_rust::config::AppConfig;
use gamer_catch_rust::scraper::scrape_rankings;
use gamer_catch_rust::sheets::{SheetsOutcome, write_daily_metrics};
use playwright_rs::install_browsers;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(author, version, about = "抓取巴哈遊戲排行與人氣並寫入 Google Sheets")]
struct Cli {
    /// TOML 設定檔路徑
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// 只抓取並顯示結果，不寫入 Google Sheets
    #[arg(long)]
    dry_run: bool,

    /// 顯示 Chromium 視窗（覆蓋設定檔的 headless）
    #[arg(long)]
    show_browser: bool,

    /// 安裝 playwright-rs 0.14.1 對應的 Chromium
    #[arg(long)]
    install_browser: bool,
}

fn main() {
    let pause_on_exit = cfg!(windows) && std::env::args_os().len() == 1;
    configure_bundled_driver();
    init_logging();
    let runtime = tokio::runtime::Runtime::new().expect("無法建立 Tokio runtime");
    let result = runtime.block_on(run());
    if let Err(error) = &result {
        eprintln!("錯誤：{error:#}");
    }
    if pause_on_exit {
        println!("\n按 Enter 關閉視窗…");
        let _ = io::stdin().read_line(&mut String::new());
    }
    if result.is_err() {
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    if cli.install_browser {
        install_browsers(Some(&["chromium"]))
            .await
            .context("Chromium 安裝失敗")?;
        println!("Chromium 安裝完成。");
        return Ok(());
    }

    let config_path = match cli.config {
        Some(path) => path,
        None => default_config_path()?,
    };
    let mut config = AppConfig::load(&config_path)?;
    if cli.show_browser {
        config.bahamut.headless = false;
    }
    if config.loaded_from_legacy {
        println!("提示：已自動載入舊版單遊戲設定；建議改用 README 的 [[games]] 多遊戲格式。");
    }

    install_browsers(Some(&["chromium"]))
        .await
        .context("自動準備 Chromium 失敗；請確認網路連線")?;

    let scrape_results = scrape_rankings(&config).await?;
    let active_games = config.active_games().collect::<Vec<_>>();
    ensure!(
        scrape_results.len() == active_games.len(),
        "內部錯誤：抓取結果與啟用遊戲數量不一致"
    );
    let mut failures = Vec::new();

    for (game, scrape_result) in active_games.into_iter().zip(scrape_results) {
        let Some(metrics) = scrape_result.metrics else {
            eprintln!(
                "找不到遊戲：{}（已掃描 page={} 到 {}）",
                scrape_result.game_name, config.bahamut.start_page, config.bahamut.end_page
            );
            failures.push(format!("{}：巴哈排行找不到", scrape_result.game_name));
            continue;
        };
        println!(
            "抓取成功：{}｜排行 {}｜人氣 {}｜page={}｜{}",
            metrics.game_name, metrics.rank, metrics.popularity, metrics.page, metrics.source_url
        );

        if cli.dry_run {
            continue;
        }
        if !game.write_to_google_sheets {
            println!(
                "{}：write_to_google_sheets=false，未寫入 Google Sheets。",
                game.game_name
            );
            continue;
        }

        match write_daily_metrics(game, &metrics).await {
            Ok(SheetsOutcome::Updated { row }) => {
                println!("{}：Google Sheets 更新完成，第 {row} 列。", game.game_name);
            }
            Ok(SheetsOutcome::SkippedNoDate) => {
                eprintln!(
                    "{}：Google Sheets 找不到今天的日期列，本次未完成。",
                    game.game_name
                );
                failures.push(format!("{}：Google Sheets 找不到今天日期", game.game_name));
            }
            Err(error) => {
                eprintln!("{}：Google Sheets 更新失敗：{error:#}", game.game_name);
                failures.push(format!("{}：Google Sheets 更新失敗", game.game_name));
            }
        }
    }

    if cli.dry_run {
        println!("dry-run：所有遊戲都未寫入 Google Sheets。");
    }
    if !failures.is_empty() {
        bail!(
            "有 {} 個項目未完成：{}",
            failures.len(),
            failures.join("；")
        );
    }

    Ok(())
}

fn default_config_path() -> Result<PathBuf> {
    let executable = std::env::current_exe().context("無法取得程式位置")?;
    let executable_config = executable
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("config.toml");
    if executable_config.is_file() {
        return Ok(executable_config);
    }

    let current_config = std::env::current_dir()
        .context("無法取得目前資料夾")?
        .join("config.toml");
    if current_config.is_file() {
        return Ok(current_config);
    }

    bail!(
        "找不到 config.toml；請將設定檔放在程式旁邊：{}",
        executable_config.display()
    )
}

fn configure_bundled_driver() {
    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    let Some(directory) = executable.parent() else {
        return;
    };
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let driver = directory.join("playwright-driver");
    if driver.join(node_name).is_file() && driver.join("package").join("cli.js").is_file() {
        // SAFETY: this runs at the start of main, before the Tokio runtime or
        // any application threads are created.
        unsafe {
            std::env::set_var("PLAYWRIGHT_DRIVER_PATH", driver);
        }
    }
}

fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("gamer_catch_rust=info,playwright_rs=warn"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
