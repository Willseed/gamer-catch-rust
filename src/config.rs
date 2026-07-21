use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use chrono_tz::Tz;
use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;
use url::Url;

const MAX_GAMES: usize = 20;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub bahamut: BahamutConfig,
    pub games: Vec<GameConfig>,
    #[serde(skip)]
    pub loaded_from_legacy: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameConfig {
    #[serde(default = "default_game_enabled")]
    pub enabled: bool,
    pub game_name: String,
    #[serde(default)]
    pub write_to_google_sheets: bool,
    #[serde(default)]
    pub spreadsheet_id: String,
    #[serde(default)]
    pub service_account_key_path: PathBuf,
    #[serde(default)]
    pub worksheet_name: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default = "default_first_data_row")]
    pub first_data_row: usize,
    #[serde(default = "default_date_column")]
    pub date_column: String,
    #[serde(default = "default_rank_column")]
    pub rank_column: String,
    #[serde(default = "default_popularity_column")]
    pub popularity_column: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BahamutConfig {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_category")]
    pub category: u32,
    #[serde(default = "default_start_page")]
    pub start_page: u32,
    #[serde(default = "default_end_page")]
    pub end_page: u32,
    #[serde(default = "default_navigation_timeout_ms")]
    pub navigation_timeout_ms: u64,
    #[serde(default = "default_page_delay_ms")]
    pub page_delay_ms: u64,
    #[serde(default = "default_headless")]
    pub headless: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyConfig {
    game: LegacyGameConfig,
    bahamut: BahamutConfig,
    google_sheets: LegacyGoogleSheetsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyGameConfig {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyGoogleSheetsConfig {
    #[serde(default)]
    enabled: bool,
    spreadsheet_id: String,
    service_account_key_path: PathBuf,
    worksheet_name: String,
    #[serde(default = "default_timezone")]
    timezone: String,
    #[serde(default = "default_first_data_row")]
    first_data_row: usize,
    columns: LegacySheetColumns,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySheetColumns {
    #[serde(default = "default_date_column")]
    date: String,
    rank: String,
    popularity: String,
}

fn default_schema_version() -> u32 {
    2
}

fn default_base_url() -> String {
    "https://forum.gamer.com.tw/".to_owned()
}

fn default_category() -> u32 {
    30
}

fn default_start_page() -> u32 {
    1
}

fn default_end_page() -> u32 {
    20
}

fn default_navigation_timeout_ms() -> u64 {
    30_000
}

fn default_page_delay_ms() -> u64 {
    500
}

fn default_headless() -> bool {
    false
}

fn default_game_enabled() -> bool {
    true
}

fn default_timezone() -> String {
    "Asia/Taipei".to_owned()
}

fn default_first_data_row() -> usize {
    2
}

fn default_date_column() -> String {
    "A".to_owned()
}

fn default_rank_column() -> String {
    "B".to_owned()
}

fn default_popularity_column() -> String {
    "C".to_owned()
}

impl AppConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let contents = fs::read_to_string(path)
            .with_context(|| format!("無法讀取設定檔：{}", path.display()))?;
        let value: toml::Value = toml::from_str(&contents)
            .with_context(|| format!("設定檔格式錯誤：{}", path.display()))?;
        let has_v2 = value.get("schema_version").is_some() || value.get("games").is_some();
        let has_v1 = value.get("game").is_some() || value.get("google_sheets").is_some();
        ensure!(
            !(has_v1 && has_v2),
            "設定檔同時包含舊版與新版欄位；請只保留 [[games]] 新版格式"
        );

        let mut config = if has_v1 {
            let legacy: LegacyConfig = toml::from_str(&contents)
                .with_context(|| format!("舊版設定檔格式錯誤：{}", path.display()))?;
            legacy.into_current()
        } else {
            toml::from_str(&contents)
                .with_context(|| format!("新版設定檔格式錯誤：{}", path.display()))?
        };
        config.validate()?;

        let base = path.parent().unwrap_or_else(|| Path::new("."));
        for game in &mut config.games {
            if game.enabled && game.write_to_google_sheets {
                game.spreadsheet_id = normalize_spreadsheet_id(&game.spreadsheet_id)?;
            }
            if !game.service_account_key_path.as_os_str().is_empty()
                && game.service_account_key_path.is_relative()
            {
                game.service_account_key_path = base.join(&game.service_account_key_path);
            }
        }

        Ok(config)
    }

    pub fn active_games(&self) -> impl Iterator<Item = &GameConfig> {
        self.games.iter().filter(|game| game.enabled)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == 2,
            "不支援 schema_version={}；目前版本為 2",
            self.schema_version
        );
        self.validate_bahamut()?;
        ensure!(!self.games.is_empty(), "至少需要一個 [[games]] 遊戲區塊");
        ensure!(
            self.games.len() <= MAX_GAMES,
            "games 最多支援 {MAX_GAMES} 個，避免意外大量操作"
        );

        let mut active_count = 0usize;
        let mut output_cells = HashSet::new();
        let mut date_cells = HashSet::new();
        for (index, game) in self.games.iter().enumerate() {
            if !game.enabled {
                continue;
            }
            active_count += 1;
            let number = index + 1;
            ensure!(
                !game.game_name.trim().is_empty(),
                "第 {number} 個 games.game_name 不可為空"
            );
            game.timezone.parse::<Tz>().with_context(|| {
                format!("遊戲「{}」的時區無效：{}", game.game_name, game.timezone)
            })?;
            ensure!(
                game.first_data_row >= 2,
                "遊戲「{}」的 first_data_row 必須至少為 2",
                game.game_name
            );

            let date = normalize_column(&game.date_column)?;
            let rank = normalize_column(&game.rank_column)?;
            let popularity = normalize_column(&game.popularity_column)?;
            ensure!(
                date != rank && date != popularity && rank != popularity,
                "遊戲「{}」的日期、排行、人氣欄位不可重複",
                game.game_name
            );

            if game.write_to_google_sheets {
                validate_google_game(game)?;
                let spreadsheet_id = normalize_spreadsheet_id(&game.spreadsheet_id)?;
                let destination = (
                    spreadsheet_id.clone(),
                    game.worksheet_name.trim().to_owned(),
                );
                let date_cell = (destination.0.clone(), destination.1.clone(), date.clone());
                ensure!(
                    !output_cells.contains(&date_cell),
                    "遊戲「{}」的日期欄位 {date} 與另一個遊戲的輸出欄位重疊",
                    game.game_name
                );
                date_cells.insert(date_cell);
                for column in [rank, popularity] {
                    let output_cell =
                        (destination.0.clone(), destination.1.clone(), column.clone());
                    ensure!(
                        !date_cells.contains(&output_cell),
                        "遊戲「{}」的 Google Sheets 輸出欄位 {column} 與日期欄位重疊",
                        game.game_name
                    );
                    ensure!(
                        output_cells.insert(output_cell),
                        "遊戲「{}」的 Google Sheets 輸出欄位 {column} 與另一個遊戲重疊",
                        game.game_name
                    );
                }
            }
        }
        ensure!(active_count > 0, "至少要有一個 games.enabled=true 的遊戲");

        Ok(())
    }

    fn validate_bahamut(&self) -> Result<()> {
        let base_url =
            Url::parse(self.bahamut.base_url.trim()).context("bahamut.base_url 不是有效網址")?;
        ensure!(
            base_url.scheme() == "https",
            "bahamut.base_url 僅允許 HTTPS"
        );
        ensure!(
            base_url.host_str() == Some("forum.gamer.com.tw"),
            "bahamut.base_url 僅允許 forum.gamer.com.tw"
        );
        ensure!(
            base_url.port_or_known_default() == Some(443),
            "bahamut.base_url 僅允許 HTTPS 443 port"
        );
        ensure!(base_url.path() == "/", "bahamut.base_url 路徑必須為 /");
        ensure!(
            base_url.username().is_empty(),
            "bahamut.base_url 不可包含帳號"
        );
        ensure!(
            base_url.password().is_none(),
            "bahamut.base_url 不可包含密碼"
        );
        ensure!(self.bahamut.category > 0, "bahamut.category 必須大於 0");
        ensure!(self.bahamut.start_page > 0, "bahamut.start_page 必須大於 0");
        ensure!(
            self.bahamut.end_page >= self.bahamut.start_page,
            "bahamut.end_page 不可小於 start_page"
        );
        ensure!(
            self.bahamut.end_page <= 200,
            "bahamut.end_page 上限為 200，避免意外大量請求"
        );
        ensure!(
            (1_000..=120_000).contains(&self.bahamut.navigation_timeout_ms),
            "bahamut.navigation_timeout_ms 必須介於 1000 到 120000"
        );
        ensure!(
            self.bahamut.page_delay_ms <= 60_000,
            "bahamut.page_delay_ms 不可超過 60000"
        );
        Ok(())
    }
}

impl LegacyConfig {
    fn into_current(self) -> AppConfig {
        AppConfig {
            schema_version: 2,
            bahamut: self.bahamut,
            games: vec![GameConfig {
                enabled: true,
                game_name: self.game.name,
                write_to_google_sheets: self.google_sheets.enabled,
                spreadsheet_id: self.google_sheets.spreadsheet_id,
                service_account_key_path: self.google_sheets.service_account_key_path,
                worksheet_name: self.google_sheets.worksheet_name,
                timezone: self.google_sheets.timezone,
                first_data_row: self.google_sheets.first_data_row,
                date_column: self.google_sheets.columns.date,
                rank_column: self.google_sheets.columns.rank,
                popularity_column: self.google_sheets.columns.popularity,
            }],
            loaded_from_legacy: true,
        }
    }
}

fn validate_google_game(game: &GameConfig) -> Result<()> {
    normalize_spreadsheet_id(&game.spreadsheet_id)?;
    ensure!(
        !game.worksheet_name.trim().is_empty(),
        "遊戲「{}」的 worksheet_name 不可為空",
        game.game_name
    );
    ensure!(
        !game.worksheet_name.chars().any(char::is_control),
        "遊戲「{}」的 worksheet_name 不可包含控制字元",
        game.game_name
    );
    ensure!(
        !game.service_account_key_path.as_os_str().is_empty(),
        "遊戲「{}」的 service_account_key_path 不可為空",
        game.game_name
    );
    Ok(())
}

pub fn normalize_spreadsheet_id(value: &str) -> Result<String> {
    let value = value.trim();
    if is_valid_spreadsheet_id(value) {
        return Ok(value.to_owned());
    }

    let url = Url::parse(value).context("spreadsheet_id 不是有效 ID 或 Google Sheets 網址")?;
    ensure!(
        url.scheme() == "https"
            && url.host_str() == Some("docs.google.com")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none(),
        "只接受 docs.google.com 的 HTTPS Google Sheets 網址"
    );
    let segments = url.path_segments().context("Google Sheets 網址缺少路徑")?;
    let segments = segments.collect::<Vec<_>>();
    ensure!(
        segments.len() >= 3 && segments[0] == "spreadsheets" && segments[1] == "d",
        "Google Sheets 網址必須包含 /spreadsheets/d/試算表ID"
    );
    let id = segments[2];
    ensure!(
        is_valid_spreadsheet_id(id),
        "Google Sheets 網址中的試算表 ID 無效"
    );
    Ok(id.to_owned())
}

fn is_valid_spreadsheet_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn normalize_column(value: &str) -> Result<String> {
    let normalized = value.trim().to_ascii_uppercase();
    if normalized.is_empty()
        || normalized.len() > 3
        || !normalized.bytes().all(|byte| byte.is_ascii_uppercase())
    {
        bail!("無效的 Google Sheets 欄位：{value}（請使用 A、B、AA 等欄名）");
    }
    Ok(normalized)
}

pub(crate) fn normalize_game_name(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(name: &str, credential: &str, spreadsheet_id: &str) -> GameConfig {
        GameConfig {
            enabled: true,
            game_name: name.to_owned(),
            write_to_google_sheets: true,
            spreadsheet_id: spreadsheet_id.to_owned(),
            service_account_key_path: PathBuf::from(credential),
            worksheet_name: "每日排名".to_owned(),
            timezone: "Asia/Taipei".to_owned(),
            first_data_row: 2,
            date_column: "A".to_owned(),
            rank_column: "B".to_owned(),
            popularity_column: "C".to_owned(),
        }
    }

    fn valid_config() -> AppConfig {
        AppConfig {
            schema_version: 2,
            bahamut: BahamutConfig {
                base_url: default_base_url(),
                category: 30,
                start_page: 1,
                end_page: 20,
                navigation_timeout_ms: 30_000,
                page_delay_ms: 0,
                headless: true,
            },
            games: vec![
                game("夜鴉", "account-a.json", "sheet-a"),
                game("另一款遊戲", "account-b.json", "sheet-b"),
            ],
            loaded_from_legacy: false,
        }
    }

    #[test]
    fn accepts_multiple_games_and_accounts() {
        let config = valid_config();
        config.validate().unwrap();
        assert_ne!(
            config.games[0].service_account_key_path,
            config.games[1].service_account_key_path
        );
    }

    #[test]
    fn allows_same_game_for_different_sheets() {
        let mut config = valid_config();
        config.games[1].game_name = " 夜鴉 ".to_owned();
        config.validate().unwrap();
    }

    #[test]
    fn accepts_full_google_sheets_url() {
        assert_eq!(
            normalize_spreadsheet_id(
                "https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=0"
            )
            .unwrap(),
            "abc_DEF-123"
        );
        assert!(normalize_spreadsheet_id("https://example.com/spreadsheets/d/abc/edit").is_err());
    }

    #[test]
    fn rejects_external_bahamut_host() {
        let mut config = valid_config();
        config.bahamut.base_url = "https://example.com/".to_owned();
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_duplicate_output_columns() {
        let mut config = valid_config();
        config.games[1].spreadsheet_id = "sheet-a".to_owned();
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_output_column_overlapping_another_games_date_column() {
        let mut config = valid_config();
        config.games[1].spreadsheet_id = "sheet-a".to_owned();
        config.games[1].date_column = "B".to_owned();
        config.games[1].rank_column = "D".to_owned();
        config.games[1].popularity_column = "E".to_owned();
        assert!(config.validate().is_err());
    }

    #[test]
    fn allows_shared_date_column_with_distinct_outputs() {
        let mut config = valid_config();
        config.games[1].spreadsheet_id = "sheet-a".to_owned();
        config.games[1].rank_column = "D".to_owned();
        config.games[1].popularity_column = "E".to_owned();
        config.validate().unwrap();
    }

    #[test]
    fn normalizes_sheet_columns() {
        assert_eq!(normalize_column(" aa ").unwrap(), "AA");
        assert!(normalize_column("A1").is_err());
        assert!(normalize_column("").is_err());
    }

    #[test]
    fn rejects_config_without_active_games() {
        let mut config = valid_config();
        for game in &mut config.games {
            game.enabled = false;
        }
        assert!(config.validate().is_err());
    }

    #[test]
    fn disabled_placeholder_does_not_require_sheet_settings() {
        let mut config = valid_config();
        config.games[1] = GameConfig {
            enabled: false,
            game_name: String::new(),
            write_to_google_sheets: true,
            spreadsheet_id: String::new(),
            service_account_key_path: PathBuf::new(),
            worksheet_name: String::new(),
            timezone: String::new(),
            first_data_row: 0,
            date_column: String::new(),
            rank_column: String::new(),
            popularity_column: String::new(),
        };
        config.validate().unwrap();
    }

    #[test]
    fn resolves_each_credential_relative_to_config_file() {
        let directory = tempfile::tempdir().unwrap();
        let key = r#"{"type":"service_account","client_email":"user@example.com","private_key":"secret"}"#;
        fs::write(directory.path().join("account-a.json"), key).unwrap();
        fs::write(directory.path().join("account-b.json"), key).unwrap();
        let config_path = directory.path().join("settings.toml");
        fs::write(
            &config_path,
            r#"
schema_version = 2

[bahamut]

[[games]]
game_name = "夜鴉"
write_to_google_sheets = true
spreadsheet_id = "sheet-a"
service_account_key_path = "account-a.json"
worksheet_name = "每日排名"

[[games]]
game_name = "另一款遊戲"
write_to_google_sheets = true
spreadsheet_id = "sheet-b"
service_account_key_path = "account-b.json"
worksheet_name = "每日排名"
"#,
        )
        .unwrap();

        let config = AppConfig::load(&config_path).unwrap();
        assert_eq!(
            config.games[0].service_account_key_path,
            directory.path().join("account-a.json")
        );
        assert_eq!(
            config.games[1].service_account_key_path,
            directory.path().join("account-b.json")
        );
    }

    #[test]
    fn missing_credential_does_not_block_other_games_during_config_load() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("settings.toml");
        fs::write(
            &config_path,
            r#"
schema_version = 2

[bahamut]

[[games]]
game_name = "夜鴉"
write_to_google_sheets = true
spreadsheet_id = "sheet-a"
service_account_key_path = "missing-a.json"
worksheet_name = "每日排名"

[[games]]
game_name = "另一款遊戲"
write_to_google_sheets = true
spreadsheet_id = "sheet-b"
service_account_key_path = "missing-b.json"
worksheet_name = "每日排名"
"#,
        )
        .unwrap();

        let config = AppConfig::load(&config_path).unwrap();
        assert_eq!(
            config.games[0].service_account_key_path,
            directory.path().join("missing-a.json")
        );
        assert_eq!(
            config.games[1].service_account_key_path,
            directory.path().join("missing-b.json")
        );
    }

    #[test]
    fn migrates_legacy_single_game_without_enabling_writes() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("settings.toml");
        fs::write(
            &config_path,
            r#"
[game]
name = "夜鴉"

[bahamut]

[google_sheets]
enabled = false
spreadsheet_id = ""
service_account_key_path = "service-account.json"
worksheet_name = ""

[google_sheets.columns]
rank = "B"
popularity = "C"
"#,
        )
        .unwrap();

        let config = AppConfig::load(&config_path).unwrap();
        assert!(config.loaded_from_legacy);
        assert_eq!(config.games.len(), 1);
        assert!(!config.games[0].write_to_google_sheets);
    }
}
