use anyhow::{Context, Result, bail, ensure};
use regex::Regex;

use super::{
    CONFIG_GENERATOR_URL, EXAMPLE_CONFIG_FILENAME, PackageArchive, PlatformFiles, WEB_GUIDE_URL,
    WINDOWS_GMAIL_AUTHORIZER_ENTRY, WINDOWS_RUNNER_ENTRY, WINDOWS_SCHEDULER_ENTRY,
    WINDOWS_SCHEDULER_SCRIPT, WINDOWS_STARTER_ENTRY,
};

const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";
const WINDOWS_NOTEPAD_EXECUTABLE: &str = "notepad.exe";

pub(super) fn decode_utf8(data: Vec<u8>, name: &str) -> Result<String> {
    String::from_utf8(data).with_context(|| format!("{name} 不是有效 UTF-8"))
}

pub(super) fn require_markers(text: &str, markers: &[&str], name: &str) -> Result<()> {
    let missing = markers
        .iter()
        .filter(|marker| !text.contains(**marker))
        .copied()
        .collect::<Vec<_>>();
    ensure!(missing.is_empty(), "{name} 缺少必要標記：{missing:?}");
    Ok(())
}

fn reject_markers(text: &str, markers: &[&str], name: &str) -> Result<()> {
    let normalized = text.to_lowercase();
    let found = markers
        .iter()
        .filter(|marker| normalized.contains(&marker.to_lowercase()))
        .copied()
        .collect::<Vec<_>>();
    ensure!(
        found.is_empty(),
        "{name} 含已停用的設定建立或編輯器標記：{found:?}"
    );
    Ok(())
}

pub(super) fn validate_windows_scripts(archive: &mut PackageArchive) -> Result<()> {
    let starter = read_utf8_cmd(archive, WINDOWS_STARTER_ENTRY)?;
    let runner = read_utf8_cmd(archive, WINDOWS_RUNNER_ENTRY)?;
    let gmail_authorizer = read_utf8_cmd(archive, WINDOWS_GMAIL_AUTHORIZER_ENTRY)?;
    let scheduler_entry = read_utf8_cmd(archive, WINDOWS_SCHEDULER_ENTRY)?;
    for (name, command) in [
        (WINDOWS_STARTER_ENTRY, starter.as_str()),
        (WINDOWS_RUNNER_ENTRY, runner.as_str()),
        (WINDOWS_GMAIL_AUTHORIZER_ENTRY, gmail_authorizer.as_str()),
        (WINDOWS_SCHEDULER_ENTRY, scheduler_entry.as_str()),
    ] {
        reject_parenthesized_cmd_control_flow(command, name)?;
        require_markers(command, &["chcp 65001 >nul"], name)?;
    }

    validate_windows_scheduler_script(archive)?;
    validate_windows_runner(&runner)?;
    validate_windows_gmail_authorizer(&gmail_authorizer)?;
    validate_windows_starter(&starter)?;
    validate_windows_scheduler_entry(&scheduler_entry)?;
    Ok(())
}

fn read_utf8_cmd(archive: &mut PackageArchive, name: &str) -> Result<String> {
    let data = archive.read_required(name)?;
    ensure!(!data.starts_with(UTF8_BOM), "{name} 必須是無 BOM 的 UTF-8");
    ensure!(uses_only_crlf(&data), "{name} 必須只使用 CRLF 換行");
    decode_utf8(data, name)
}

fn uses_only_crlf(data: &[u8]) -> bool {
    let has_crlf = data.windows(2).any(|window| window == b"\r\n");
    has_crlf
        && data.iter().enumerate().all(|(index, byte)| match byte {
            b'\r' => data.get(index + 1) == Some(&b'\n'),
            b'\n' => index > 0 && data.get(index - 1) == Some(&b'\r'),
            _ => true,
        })
}

fn reject_parenthesized_cmd_control_flow(script: &str, name: &str) -> Result<()> {
    let pattern = Regex::new(r"(?im)^\s*if\b[^\r\n]*\(|^\s*for\b[^\r\n]*\bdo\s*\(")?;
    ensure!(
        !pattern.is_match(script),
        "{name} 不可使用會破壞 UTF-8 輸出的括號 CMD control flow"
    );
    Ok(())
}

fn validate_windows_scheduler_script(archive: &mut PackageArchive) -> Result<()> {
    let data = archive.read_required(WINDOWS_SCHEDULER_SCRIPT)?;
    ensure!(
        data.is_ascii(),
        "{WINDOWS_SCHEDULER_SCRIPT} 必須保持純 ASCII"
    );
    let script = std::str::from_utf8(&data)?;
    require_markers(
        script,
        &[
            "-ScheduledRun",
            "New-ScheduledTaskTrigger -Daily",
            "-LogonType Interactive",
            "-RunLevel Limited",
            "-StartWhenAvailable",
            "-WakeToRun",
            "-RunOnlyIfNetworkAvailable",
            "-AllowStartIfOnBatteries",
            "-DontStopIfGoingOnBatteries",
            "-MultipleInstances IgnoreNew",
            "Register-ScheduledTask",
            "last-scheduled-run.log",
        ],
        WINDOWS_SCHEDULER_SCRIPT,
    )?;
    let forbidden = Regex::new(r"(?i)(?:-RunLevel\s+Highest|-Verb\s+RunAs|Set-ExecutionPolicy)")?;
    if let Some(found) = forbidden.find(script) {
        bail!("排程含不安全的權限或 policy 設定：{:?}", found.as_str());
    }
    Ok(())
}

fn validate_windows_runner(runner: &str) -> Result<()> {
    require_markers(
        runner,
        &[
            CONFIG_GENERATOR_URL,
            "goto :run_failed",
            "--no-pause",
            "有項目未完成，請查看上方錯誤訊息或 last-run.log。",
        ],
        WINDOWS_RUNNER_ENTRY,
    )?;
    reject_markers(
        runner,
        &[
            EXAMPLE_CONFIG_FILENAME,
            WINDOWS_NOTEPAD_EXECUTABLE,
            "start ",
        ],
        WINDOWS_RUNNER_ENTRY,
    )
}

fn validate_windows_gmail_authorizer(authorizer: &str) -> Result<()> {
    require_markers(
        authorizer,
        &[
            CONFIG_GENERATOR_URL,
            "--authorize-gmail",
            "last-gmail-authorization.log",
            "goto :authorization_failed",
            "--no-pause",
        ],
        WINDOWS_GMAIL_AUTHORIZER_ENTRY,
    )?;
    reject_markers(
        authorizer,
        &[
            EXAMPLE_CONFIG_FILENAME,
            WINDOWS_NOTEPAD_EXECUTABLE,
            "start ",
        ],
        WINDOWS_GMAIL_AUTHORIZER_ENTRY,
    )
}

fn validate_windows_starter(starter: &str) -> Result<()> {
    require_markers(
        starter,
        &[WEB_GUIDE_URL, "explorer.exe \"%CREDENTIALS%\""],
        WINDOWS_STARTER_ENTRY,
    )?;
    reject_markers(
        starter,
        &[
            "set \"CONFIG=",
            EXAMPLE_CONFIG_FILENAME,
            "copy /Y",
            WINDOWS_NOTEPAD_EXECUTABLE,
        ],
        WINDOWS_STARTER_ENTRY,
    )
}

fn validate_windows_scheduler_entry(entry: &str) -> Result<()> {
    require_markers(
        entry,
        &[
            WINDOWS_SCHEDULER_SCRIPT,
            "-ExecutionPolicy Bypass",
            "goto :install_failed",
            "--no-pause",
            "安裝成功。不需要系統管理員權限，也不會儲存 Windows 密碼。",
            "重新雙擊本檔案會更新原本的排程，不會建立重複工作。",
        ],
        WINDOWS_SCHEDULER_ENTRY,
    )
}

pub(super) fn validate_macos_gmail_authorizer(
    archive: &mut PackageArchive,
    files: PlatformFiles,
) -> Result<()> {
    let name = files.gmail_authorizer;
    let script = decode_utf8(archive.read_required(name)?, name)?;
    require_markers(
        &script,
        &[
            CONFIG_GENERATOR_URL,
            "--authorize-gmail",
            "last-gmail-authorization.log",
            "set -uo pipefail",
        ],
        name,
    )?;
    reject_markers(
        &script,
        &[EXAMPLE_CONFIG_FILENAME, "TextEdit", "open "],
        name,
    )
}

pub(super) fn validate_macos_runner(
    archive: &mut PackageArchive,
    files: PlatformFiles,
) -> Result<()> {
    let name = files.runner;
    let script = decode_utf8(archive.read_required(name)?, name)?;
    require_markers(
        &script,
        &[CONFIG_GENERATOR_URL, "last-run.log", "set -uo pipefail"],
        name,
    )?;
    reject_markers(
        &script,
        &[EXAMPLE_CONFIG_FILENAME, "TextEdit", "open "],
        name,
    )
}

pub(super) fn validate_macos_starter(
    archive: &mut PackageArchive,
    files: PlatformFiles,
) -> Result<()> {
    let name = files.starter;
    let script = decode_utf8(archive.read_required(name)?, name)?;
    require_markers(&script, &[WEB_GUIDE_URL, "open \"$CREDENTIALS_DIR\""], name)?;
    reject_markers(
        &script,
        &["CONFIG_PATH=", EXAMPLE_CONFIG_FILENAME, "cp ", "TextEdit"],
        name,
    )
}

#[cfg(test)]
mod tests {
    use super::{reject_parenthesized_cmd_control_flow, uses_only_crlf};

    #[test]
    fn enforces_windows_line_endings() {
        assert!(uses_only_crlf(b"one\r\ntwo\r\n"));
        assert!(!uses_only_crlf(b"one\ntwo\n"));
        assert!(!uses_only_crlf(b"one\r\ntwo\n"));
    }

    #[test]
    fn rejects_parenthesized_cmd_control_flow() {
        assert!(reject_parenthesized_cmd_control_flow("if exist file (\r\n", "test").is_err());
        assert!(reject_parenthesized_cmd_control_flow("goto :safe\r\n", "test").is_ok());
    }
}
