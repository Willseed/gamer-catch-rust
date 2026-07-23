use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;

#[derive(Debug, Eq, PartialEq)]
pub struct NotarySubmission {
    pub status: String,
    pub id: String,
}

pub fn parse_submission(source: &str) -> Result<NotarySubmission> {
    let response = parse_object(source, "notarytool submit")?;
    let status = response
        .get("status")
        .and_then(Value::as_str)
        .context("notarytool submit 回覆缺少字串 status")?;
    ensure!(
        !status.is_empty() && !status.chars().any(|character| "\t\r\n".contains(character)),
        "notarytool submit status 必須是單行非空字串"
    );
    let id = response
        .get("id")
        .and_then(Value::as_str)
        .context("notarytool submit 回覆缺少字串 id")?;
    ensure!(is_uuid(id), "notarytool submit id 不是有效 UUID");

    Ok(NotarySubmission {
        status: status.to_owned(),
        id: id.to_owned(),
    })
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

pub fn parse_issue_count(source: &str) -> Result<usize> {
    let response = parse_object(source, "notarytool log")?;
    let Some(issues) = response.get("issues") else {
        bail!("notarytool log 回覆缺少 issues");
    };
    if issues.is_null() {
        return Ok(0);
    }
    let issues = issues
        .as_array()
        .context("notarytool log issues 必須是陣列或 null")?;
    Ok(issues.len())
}

fn parse_object(source: &str, name: &str) -> Result<serde_json::Map<String, Value>> {
    let value: Value =
        serde_json::from_str(source).with_context(|| format!("{name} 回覆不是有效 JSON"))?;
    value
        .as_object()
        .cloned()
        .with_context(|| format!("{name} 回覆必須是 JSON object"))
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{parse_issue_count, parse_submission};

    #[test]
    fn accepts_a_valid_submission_and_empty_issue_log() -> Result<()> {
        let submission = parse_submission(
            r#"{"status":"Accepted","id":"505f9fb7-3d72-4fb4-baa2-720d660efaf7"}"#,
        )?;
        assert_eq!(submission.status, "Accepted");
        assert_eq!(submission.id, "505f9fb7-3d72-4fb4-baa2-720d660efaf7");
        assert_eq!(parse_issue_count(r#"{"issues":null}"#)?, 0);
        assert_eq!(parse_issue_count(r#"{"issues":[]}"#)?, 0);
        Ok(())
    }

    #[test]
    fn rejects_malformed_or_incomplete_notary_responses() {
        assert!(parse_submission(r#"{"status":"Accepted"}"#).is_err());
        assert!(
            parse_submission(
                r#"{"status":"Accepted\nInjected","id":"505f9fb7-3d72-4fb4-baa2-720d660efaf7"}"#
            )
            .is_err()
        );
        assert!(parse_issue_count(r#"{}"#).is_err());
        assert!(parse_issue_count(r#"{"issues":{}}"#).is_err());
    }
}
