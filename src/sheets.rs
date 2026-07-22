use anyhow::{Context, Result, bail, ensure};
use chrono::{Days, NaiveDate, Utc};
use chrono_tz::Tz;
use google_sheets4::api::{BatchUpdateValuesRequest, Scope, ValueRange};
use google_sheets4::{Sheets, hyper_rustls, hyper_util, yup_oauth2};
use serde_json::{Value, json};

use crate::config::{GameConfig, normalize_column};
use crate::scraper::RankingMetrics;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SheetsOutcome {
    Updated { row: usize },
    SkippedNoDate,
}

pub async fn write_daily_metrics(
    config: &GameConfig,
    metrics: &RankingMetrics,
) -> Result<SheetsOutcome> {
    let key = yup_oauth2::read_service_account_key(&config.service_account_key_path)
        .await
        .with_context(|| {
            format!(
                "無法讀取 Google service account JSON：{}",
                config.service_account_key_path.display()
            )
        })?;
    let auth = yup_oauth2::ServiceAccountAuthenticator::builder(key)
        .build()
        .await
        .context("建立 Google service account 驗證失敗")?;

    let connector = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .context("載入系統 TLS 憑證失敗")?
        .https_only()
        .enable_http2()
        .build();
    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(connector);
    let hub = Sheets::new(client, auth);

    let date_column = normalize_column(&config.date_column)?;
    let date_range = format!(
        "{}!{}1:{}",
        quote_sheet_name(&config.worksheet_name),
        date_column,
        date_column
    );
    let (_, values) = hub
        .spreadsheets()
        .values_get(&config.spreadsheet_id, &date_range)
        .value_render_option("UNFORMATTED_VALUE")
        .date_time_render_option("SERIAL_NUMBER")
        .major_dimension("ROWS")
        .add_scope(Scope::Spreadsheet)
        .doit()
        .await
        .context("讀取 Google Sheets 日期欄失敗")?;

    let timezone: Tz = config.timezone.parse()?;
    let today = Utc::now().with_timezone(&timezone).date_naive();
    let rows = values.values.unwrap_or_default();
    let Some(row) = find_date_row(&rows, today, config.first_data_row)? else {
        return Ok(SheetsOutcome::SkippedNoDate);
    };

    let rank_column = normalize_column(&config.rank_column)?;
    let popularity_column = normalize_column(&config.popularity_column)?;
    ensure!(
        metrics.popularity <= 9_007_199_254_740_991,
        "人氣超過 Google Sheets 可精確表示的整數範圍"
    );
    let rank_range = cell_range(&config.worksheet_name, &rank_column, row);
    let popularity_range = cell_range(&config.worksheet_name, &popularity_column, row);
    let request = BatchUpdateValuesRequest {
        data: Some(vec![
            ValueRange {
                major_dimension: Some("ROWS".to_owned()),
                range: Some(rank_range),
                values: Some(vec![vec![json!(metrics.rank)]]),
            },
            ValueRange {
                major_dimension: Some("ROWS".to_owned()),
                range: Some(popularity_range),
                values: Some(vec![vec![json!(metrics.popularity)]]),
            },
        ]),
        include_values_in_response: Some(false),
        response_date_time_render_option: None,
        response_value_render_option: None,
        value_input_option: Some("RAW".to_owned()),
    };

    let (_, response) = hub
        .spreadsheets()
        .values_batch_update(request, &config.spreadsheet_id)
        .add_scope(Scope::Spreadsheet)
        .doit()
        .await
        .context("寫入 Google Sheets 排行與人氣失敗")?;
    ensure!(
        response.total_updated_cells == Some(2),
        "Google Sheets 已接受寫入要求，但回報的更新格數不是預期的 2（實際 {:?}）；請人工確認該列後再決定是否重試",
        response.total_updated_cells
    );

    Ok(SheetsOutcome::Updated { row })
}

fn quote_sheet_name(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn cell_range(sheet_name: &str, column: &str, row: usize) -> String {
    format!("{}!{column}{row}", quote_sheet_name(sheet_name))
}

fn find_date_row(
    rows: &[Vec<Value>],
    target: NaiveDate,
    first_data_row: usize,
) -> Result<Option<usize>> {
    let mut matches = Vec::new();
    for (zero_based_index, row) in rows.iter().enumerate() {
        let sheet_row = zero_based_index + 1;
        if sheet_row < first_data_row {
            continue;
        }
        let Some(value) = row.first() else {
            continue;
        };
        if parse_sheet_date(value) == Some(target) {
            matches.push(sheet_row);
        }
    }

    match matches.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some(*row)),
        _ => bail!("日期 {} 在工作表出現超過一次", target.format("%Y-%m-%d")),
    }
}

fn parse_sheet_date(value: &Value) -> Option<NaiveDate> {
    match value {
        Value::Number(number) => parse_serial_date(number.as_f64()?),
        Value::String(text) => parse_text_date(text),
        _ => None,
    }
}

fn parse_serial_date(serial: f64) -> Option<NaiveDate> {
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    let days = serial.floor();
    if days > u64::MAX as f64 {
        return None;
    }
    NaiveDate::from_ymd_opt(1899, 12, 30)?.checked_add_days(Days::new(days as u64))
}

fn parse_text_date(value: &str) -> Option<NaiveDate> {
    let value = value.trim();
    for format in ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m-%d-%Y"] {
        if let Ok(date) = NaiveDate::parse_from_str(value, format) {
            return Some(date);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_apostrophes_in_sheet_names() {
        assert_eq!(quote_sheet_name("Bob's data"), "'Bob''s data'");
        assert_eq!(cell_range("每日排名", "B", 12), "'每日排名'!B12");
    }

    #[test]
    fn parses_only_supported_dates_with_their_actual_year() {
        let expected = NaiveDate::from_ymd_opt(2026, 7, 21).unwrap();
        for value in ["2026-07-21", "2026/7/21", "07/21/2026"] {
            assert_eq!(parse_sheet_date(&json!(value)), Some(expected));
        }
        assert_eq!(parse_sheet_date(&json!("7/21")), None);

        let epoch = NaiveDate::from_ymd_opt(1899, 12, 30).unwrap();
        let serial = (expected - epoch).num_days();
        assert_eq!(parse_sheet_date(&json!(serial)), Some(expected));
        let old_date = NaiveDate::from_ymd_opt(2025, 7, 21).unwrap();
        let serial = (old_date - epoch).num_days();
        assert_ne!(
            parse_sheet_date(&json!(serial)),
            NaiveDate::from_ymd_opt(2026, 7, 21)
        );
    }

    #[test]
    fn requires_exactly_one_daily_row() {
        let rows = vec![
            vec![json!("日期")],
            vec![json!("2026-07-20")],
            vec![json!("2026-07-21")],
        ];
        let target = NaiveDate::from_ymd_opt(2026, 7, 21).unwrap();
        assert_eq!(find_date_row(&rows, target, 2).unwrap(), Some(3));
        let rows = vec![
            vec![json!("日期")],
            vec![json!("2026/7/21")],
            vec![json!("2026-07-21")],
        ];
        assert!(find_date_row(&rows, target, 2).is_err());
    }
}
