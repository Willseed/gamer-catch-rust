use anyhow::{Context, Result, ensure};
use toml::Value;

use super::EXAMPLE_CONFIG_FILENAME;

pub(super) fn validate_example_config(data: &[u8]) -> Result<()> {
    let source =
        std::str::from_utf8(data).context(format!("{EXAMPLE_CONFIG_FILENAME} 必須是有效 UTF-8"))?;
    let config = toml::from_str::<Value>(source)
        .context(format!("{EXAMPLE_CONFIG_FILENAME} 不是有效 TOML"))?;
    ensure!(
        config.get("schema_version").and_then(Value::as_integer) == Some(2),
        "{EXAMPLE_CONFIG_FILENAME} 必須使用 schema_version = 2"
    );
    let games = config
        .get("games")
        .and_then(Value::as_array)
        .context(format!("{EXAMPLE_CONFIG_FILENAME} 必須包含 games 陣列"))?;
    ensure!(games.len() >= 3, "安全範例至少要有三個新手遊戲欄位");
    ensure!(
        games.iter().all(|game| {
            game.get("enabled").and_then(Value::as_bool).is_some()
                && game
                    .get("write_to_google_sheets")
                    .and_then(Value::as_bool)
                    .is_some()
        }),
        "每個新手遊戲欄位的 enabled 與 write_to_google_sheets 必須是布林值"
    );
    ensure!(
        games
            .iter()
            .filter(|game| game.get("enabled").and_then(Value::as_bool) == Some(true))
            .count()
            == 1,
        "安全範例必須正好啟用一個遊戲"
    );
    ensure!(
        games.iter().all(|game| {
            game.get("write_to_google_sheets").and_then(Value::as_bool) != Some(true)
        }),
        "安全範例必須停用所有 Google Sheets 寫入"
    );
    ensure!(
        games.iter().all(|game| {
            game.get("notification_recipients")
                .and_then(Value::as_array)
                .is_some()
        }),
        "每個新手遊戲欄位都必須包含 notification_recipients"
    );

    let gmail = config
        .get("gmail_notifications")
        .and_then(Value::as_table)
        .context("安全範例必須包含 gmail_notifications table")?;
    ensure!(
        gmail.get("enabled").and_then(Value::as_bool) == Some(false),
        "安全範例必須停用 Gmail 通知"
    );
    ensure!(
        gmail
            .get("oauth_client_secret_path")
            .and_then(Value::as_str)
            == Some("credentials/gmail-oauth-client.json"),
        "安全範例必須使用文件指定的 Gmail OAuth JSON 路徑"
    );
    let forbidden = [
        "access_token",
        "client_secret",
        "private_key",
        "refresh_token",
    ];
    ensure!(
        !contains_forbidden_key(&config, &forbidden),
        "{EXAMPLE_CONFIG_FILENAME} 不可包含內嵌秘密"
    );
    Ok(())
}

fn contains_forbidden_key(value: &Value, forbidden: &[&str]) -> bool {
    match value {
        Value::Table(table) => table.iter().any(|(key, child)| {
            forbidden.contains(&key.as_str()) || contains_forbidden_key(child, forbidden)
        }),
        Value::Array(values) => values
            .iter()
            .any(|child| contains_forbidden_key(child, forbidden)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_example_config;

    const SAFE_CONFIG: &str = r#"
schema_version = 2

[gmail_notifications]
enabled = false
oauth_client_secret_path = "credentials/gmail-oauth-client.json"

[[games]]
enabled = true
write_to_google_sheets = false
notification_recipients = []

[[games]]
enabled = false
write_to_google_sheets = false
notification_recipients = []

[[games]]
enabled = false
write_to_google_sheets = false
notification_recipients = []
"#;

    #[test]
    fn accepts_the_safe_beginner_contract() {
        assert!(validate_example_config(SAFE_CONFIG.as_bytes()).is_ok());
    }

    #[test]
    fn rejects_inline_secret_material() {
        let unsafe_config = format!("{SAFE_CONFIG}\nprivate_key = \"secret\"\n");
        assert!(validate_example_config(unsafe_config.as_bytes()).is_err());
    }
}
