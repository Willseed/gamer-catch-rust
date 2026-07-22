#!/usr/bin/env python3
"""Validate a GamerCatch release ZIP using only the Python standard library."""

from __future__ import annotations

import argparse
import io
import re
import sys
import tomllib
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath


CONFIG_FILENAME = "config.toml"
EXAMPLE_CONFIG_FILENAME = "config.example.toml"
CREDENTIALS_DIRECTORY = "credentials"
USAGE_FILENAME = "使用說明.txt"
WEB_GUIDE_URL = "https://gamer-catch.pylot.dev/guide#quick-start"
CONFIG_GENERATOR_URL = "https://gamer-catch.pylot.dev/generator"
WINDOWS_STARTER_ENTRY = "1_首次設定.cmd"
WINDOWS_RUNNER_ENTRY = "2_開始抓取.cmd"
WINDOWS_GMAIL_AUTHORIZER_ENTRY = "Gmail_首次授權.cmd"
WINDOWS_SCHEDULER_ENTRY = "3_安裝每天早上9點自動抓取.cmd"
WINDOWS_SCHEDULER_SCRIPT = "install-windows-task.ps1"
WINDOWS_CMD_ENTRIES = (
    WINDOWS_STARTER_ENTRY,
    WINDOWS_RUNNER_ENTRY,
    WINDOWS_GMAIL_AUTHORIZER_ENTRY,
    WINDOWS_SCHEDULER_ENTRY,
)
PARENTHESIZED_CMD_CONTROL_FLOW = re.compile(
    r"(?im)^\s*if\b[^\r\n]*\(|^\s*for\b[^\r\n]*\bdo\s*\("
)
UTF8_BOM = b"\xef\xbb\xbf"

COMMON_REQUIRED = {
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    USAGE_FILENAME,
    EXAMPLE_CONFIG_FILENAME,
}


@dataclass(frozen=True)
class PlatformFiles:
    executable: str
    driver_node: str
    starter: str
    runner: str
    gmail_authorizer: str
    extra_required: tuple[str, ...] = ()


PLATFORM_FILES = {
    "macos": PlatformFiles(
        executable="GamerCatch",
        driver_node="playwright-driver/node",
        starter="1_首次設定.command",
        runner="2_開始抓取.command",
        gmail_authorizer="Gmail_首次授權.command",
    ),
    "windows": PlatformFiles(
        executable="GamerCatch.exe",
        driver_node="playwright-driver/node.exe",
        starter=WINDOWS_STARTER_ENTRY,
        runner=WINDOWS_RUNNER_ENTRY,
        gmail_authorizer=WINDOWS_GMAIL_AUTHORIZER_ENTRY,
        extra_required=(WINDOWS_SCHEDULER_ENTRY, WINDOWS_SCHEDULER_SCRIPT),
    ),
}


def fail(message: str) -> None:
    raise ValueError(message)


def matching_entry(entries: list[str], suffix: str) -> str:
    expected_parts = PurePosixPath(suffix).parts
    matches = []
    for entry in entries:
        parts = PurePosixPath(entry).parts
        if len(parts) == len(expected_parts) + 1 and parts[1:] == expected_parts:
            matches.append(entry)
    if len(matches) != 1:
        fail(f"expected exactly one {suffix!r}, found {matches}")
    return matches[0]


def read_required(archive: zipfile.ZipFile, entries: list[str], suffix: str) -> bytes:
    entry = matching_entry(entries, suffix)
    data = archive.read(entry)
    if not data:
        fail(f"required file is empty: {entry}")
    return data


def contains_forbidden_key(value: object, forbidden: set[str]) -> bool:
    if isinstance(value, dict):
        return any(
            key in forbidden or contains_forbidden_key(child, forbidden)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(contains_forbidden_key(child, forbidden) for child in value)
    return False


def validate_example_config(data: bytes) -> None:
    try:
        config = tomllib.load(io.BytesIO(data))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as error:
        fail(f"{EXAMPLE_CONFIG_FILENAME} is invalid: {error}")
    if config.get("schema_version") != 2:
        fail(f"{EXAMPLE_CONFIG_FILENAME} must use schema_version = 2")
    games = config.get("games")
    if not isinstance(games, list) or len(games) < 3:
        fail(f"{EXAMPLE_CONFIG_FILENAME} must contain at least three beginner game slots")
    if sum(bool(game.get("enabled")) for game in games) != 1:
        fail("safe example must enable exactly one game")
    if any(bool(game.get("write_to_google_sheets")) for game in games):
        fail("safe example must disable all Google Sheets writes")
    gmail = config.get("gmail_notifications")
    if not isinstance(gmail, dict) or gmail.get("enabled") is not False:
        fail("safe example must include disabled Gmail notifications")
    if gmail.get("oauth_client_secret_path") != "credentials/gmail-oauth-client.json":
        fail("safe example must use the documented Gmail OAuth JSON path")
    forbidden_secret_keys = {"access_token", "client_secret", "private_key", "refresh_token"}
    if contains_forbidden_key(config, forbidden_secret_keys):
        fail(f"{EXAMPLE_CONFIG_FILENAME} unexpectedly contains inline secret material")
    for game in games:
        recipients = game.get("notification_recipients")
        if not isinstance(recipients, list):
            fail("every beginner game slot must include notification_recipients")


def validate_no_local_build_paths(data: bytes) -> None:
    local_path = re.compile(
        rb"(?:/Users/[^/\x00]+/|/home/runner/work/|[A-Z]:\\Users\\[^\\\x00]+\\|[A-Z]:\\a\\)",
        re.IGNORECASE,
    )
    match = local_path.search(data)
    if match:
        display = match.group(0).decode("utf-8", errors="replace")
        fail(f"executable leaks a local build path: {display}")


def validate_zip_structure(archive: zipfile.ZipFile) -> list[str]:
    bad = archive.testzip()
    if bad:
        fail(f"ZIP CRC check failed at {bad}")

    entries = [info.filename for info in archive.infolist() if not info.is_dir()]
    if not entries:
        fail("ZIP contains no files")

    roots = {PurePosixPath(entry).parts[0] for entry in entries}
    if len(roots) != 1:
        fail(f"ZIP must contain exactly one top-level folder, found: {sorted(roots)}")

    toml_entries = []
    for entry in entries:
        parsed = PurePosixPath(entry)
        if parsed.is_absolute() or ".." in parsed.parts:
            fail(f"unsafe ZIP path: {entry}")
        if parsed.name == CONFIG_FILENAME:
            fail(
                f"release ZIP must not include mutable {CONFIG_FILENAME}; "
                f"users download it from the configuration generator: {entry}"
            )
        if parsed.suffix.lower() == ".toml" and parsed.name != EXAMPLE_CONFIG_FILENAME:
            fail(
                f"release ZIP may only include {EXAMPLE_CONFIG_FILENAME} as TOML: {entry}"
            )
        if parsed.suffix.lower() == ".toml":
            toml_entries.append(entry)
        if parsed.suffix.lower() == ".pdf":
            fail(f"release ZIP must use the online guide instead of PDF: {entry}")
    if len(toml_entries) != 1:
        fail(
            f"release ZIP must contain exactly one {EXAMPLE_CONFIG_FILENAME}; "
            f"found: {toml_entries}"
        )
    return entries


def validate_required_files(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> tuple[bytes, bytes]:
    existence_only = (COMMON_REQUIRED - {EXAMPLE_CONFIG_FILENAME, USAGE_FILENAME}) | {
        files.starter,
        files.runner,
        files.gmail_authorizer,
        "playwright-driver/package/cli.js",
    } | set(files.extra_required)
    for required in existence_only:
        read_required(archive, entries, required)

    validate_example_config(read_required(archive, entries, EXAMPLE_CONFIG_FILENAME))
    usage = decode_utf8(read_required(archive, entries, USAGE_FILENAME), USAGE_FILENAME)
    require_markers(usage, (WEB_GUIDE_URL,), USAGE_FILENAME)
    return (
        read_required(archive, entries, files.executable),
        read_required(archive, entries, files.driver_node),
    )


def require_markers(text: str, markers: tuple[str, ...], name: str) -> None:
    missing = [marker for marker in markers if marker not in text]
    if missing:
        fail(f"{name} is missing required markers: {missing}")


def reject_markers(text: str, markers: tuple[str, ...], name: str) -> None:
    normalized = text.casefold()
    found = [marker for marker in markers if marker.casefold() in normalized]
    if found:
        fail(f"{name} contains retired config creation or editor markers: {found}")


def decode_utf8(data: bytes, name: str) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"{name} is not UTF-8: {error}")


def read_utf8_cmd(
    archive: zipfile.ZipFile, entries: list[str], name: str
) -> str:
    data = read_required(archive, entries, name)
    if data.startswith(UTF8_BOM):
        fail(f"{name} must be UTF-8 without a byte-order mark")
    remaining_line_endings = data.replace(b"\r\n", b"")
    if (
        b"\r\n" not in data
        or b"\r" in remaining_line_endings
        or b"\n" in remaining_line_endings
    ):
        fail(f"{name} must use CRLF line endings")
    return decode_utf8(data, name)


def reject_parenthesized_cmd_control_flow(script: str, name: str) -> None:
    if PARENTHESIZED_CMD_CONTROL_FLOW.search(script):
        fail(f"{name} must not use parenthesized CMD control flow with UTF-8 output")


def validate_windows_scheduler(
    archive: zipfile.ZipFile, entries: list[str]
) -> None:
    commands = {
        name: read_utf8_cmd(archive, entries, name) for name in WINDOWS_CMD_ENTRIES
    }
    for name, command in commands.items():
        reject_parenthesized_cmd_control_flow(command, name)
        require_markers(command, ("chcp 65001 >nul",), name)

    script_data = read_required(archive, entries, WINDOWS_SCHEDULER_SCRIPT)
    try:
        script = script_data.decode("ascii")
    except UnicodeDecodeError as error:
        fail(f"{WINDOWS_SCHEDULER_SCRIPT} must remain ASCII-only: {error}")

    require_markers(
        script,
        (
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
        ),
        WINDOWS_SCHEDULER_SCRIPT,
    )
    forbidden = re.compile(
        r"(?:-RunLevel\s+Highest|-Verb\s+RunAs|Set-ExecutionPolicy)",
        re.IGNORECASE,
    )
    match = forbidden.search(script)
    if match:
        fail(f"unsafe scheduler privilege or policy setting: {match.group(0)!r}")

    runner = commands[WINDOWS_RUNNER_ENTRY]
    require_markers(
        runner,
        (
            CONFIG_GENERATOR_URL,
            "goto :run_failed",
            "--no-pause",
            "有項目未完成，請查看上方錯誤訊息或 last-run.log。",
        ),
        WINDOWS_RUNNER_ENTRY,
    )
    reject_markers(
        runner,
        (EXAMPLE_CONFIG_FILENAME, "notepad.exe", "start "),
        WINDOWS_RUNNER_ENTRY,
    )

    gmail_authorizer = commands[WINDOWS_GMAIL_AUTHORIZER_ENTRY]
    require_markers(
        gmail_authorizer,
        (
            CONFIG_GENERATOR_URL,
            "--authorize-gmail",
            "last-gmail-authorization.log",
            "goto :authorization_failed",
            "--no-pause",
        ),
        WINDOWS_GMAIL_AUTHORIZER_ENTRY,
    )
    reject_markers(
        gmail_authorizer,
        (EXAMPLE_CONFIG_FILENAME, "notepad.exe", "start "),
        WINDOWS_GMAIL_AUTHORIZER_ENTRY,
    )

    starter = commands[WINDOWS_STARTER_ENTRY]
    require_markers(
        starter,
        (WEB_GUIDE_URL, 'explorer.exe "%CREDENTIALS%"'),
        WINDOWS_STARTER_ENTRY,
    )
    reject_markers(
        starter,
        ('set "CONFIG=', EXAMPLE_CONFIG_FILENAME, "copy /Y", "notepad.exe"),
        WINDOWS_STARTER_ENTRY,
    )

    entry = commands[WINDOWS_SCHEDULER_ENTRY]
    require_markers(
        entry,
        (
            WINDOWS_SCHEDULER_SCRIPT,
            "-ExecutionPolicy Bypass",
            "goto :install_failed",
            "--no-pause",
            "安裝成功。不需要系統管理員權限，也不會儲存 Windows 密碼。",
            "重新雙擊本檔案會更新原本的排程，不會建立重複工作。",
        ),
        WINDOWS_SCHEDULER_ENTRY,
    )


def validate_binary_format(
    executable_data: bytes, driver_data: bytes, platform: str
) -> None:
    if platform == "windows":
        if not executable_data.startswith(b"MZ") or not driver_data.startswith(b"MZ"):
            fail("Windows executable or bundled Node is not a PE file")
        return

    macho_magics = {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}
    if executable_data[:4] not in macho_magics or driver_data[:4] not in macho_magics:
        fail("macOS executable or bundled Node is not a Mach-O file")


def validate_macos_executable_modes(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> None:
    required_executables = [
        files.executable,
        files.driver_node,
        files.starter,
        files.runner,
        files.gmail_authorizer,
    ]
    for required in required_executables:
        info = archive.getinfo(matching_entry(entries, required))
        mode = (info.external_attr >> 16) & 0o777
        if mode & 0o111 == 0:
            fail(f"macOS release entry is not executable: {required}")


def validate_macos_gmail_authorizer(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> None:
    data = read_required(archive, entries, files.gmail_authorizer)
    script = decode_utf8(data, files.gmail_authorizer)
    require_markers(
        script,
        (
            CONFIG_GENERATOR_URL,
            "--authorize-gmail",
            "last-gmail-authorization.log",
            "set -uo pipefail",
        ),
        files.gmail_authorizer,
    )
    reject_markers(
        script,
        (EXAMPLE_CONFIG_FILENAME, "TextEdit", "open "),
        files.gmail_authorizer,
    )


def validate_macos_runner(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> None:
    data = read_required(archive, entries, files.runner)
    script = decode_utf8(data, files.runner)
    require_markers(
        script,
        (CONFIG_GENERATOR_URL, "last-run.log", "set -uo pipefail"),
        files.runner,
    )
    reject_markers(
        script,
        (EXAMPLE_CONFIG_FILENAME, "TextEdit", "open "),
        files.runner,
    )


def validate_macos_starter(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> None:
    data = read_required(archive, entries, files.starter)
    script = decode_utf8(data, files.starter)
    require_markers(
        script,
        (WEB_GUIDE_URL, 'open "$CREDENTIALS_DIR"'),
        files.starter,
    )
    reject_markers(
        script,
        ("CONFIG_PATH=", EXAMPLE_CONFIG_FILENAME, "cp ", "TextEdit"),
        files.starter,
    )


def validate_empty_credentials_directory(
    archive: zipfile.ZipFile, entries: list[str]
) -> None:
    root = PurePosixPath(entries[0]).parts[0]
    directory_name = f"{root}/{CREDENTIALS_DIRECTORY}/"
    try:
        directory = archive.getinfo(directory_name)
    except KeyError:
        fail(f"release ZIP is missing the empty {CREDENTIALS_DIRECTORY}/ directory")
    if not directory.is_dir():
        fail(f"release ZIP entry is not a directory: {directory_name}")

    credential_files = [
        info.filename
        for info in archive.infolist()
        if info.filename.startswith(directory_name) and not info.is_dir()
    ]
    if credential_files:
        fail(f"release ZIP credentials directory must be empty: {credential_files}")


def validate_archive(path: str, platform: str) -> None:
    files = PLATFORM_FILES[platform]

    with zipfile.ZipFile(path) as archive:
        entries = validate_zip_structure(archive)
        executable_data, driver_data = validate_required_files(archive, entries, files)
        validate_no_local_build_paths(executable_data)
        validate_binary_format(executable_data, driver_data, platform)
        if platform == "macos":
            validate_macos_executable_modes(archive, entries, files)
            validate_macos_gmail_authorizer(archive, entries, files)
            validate_macos_runner(archive, entries, files)
            validate_macos_starter(archive, entries, files)
        else:
            validate_windows_scheduler(archive, entries)
        validate_empty_credentials_directory(archive, entries)

    print(f"validated {platform} package: {path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=["macos", "windows"])
    parser.add_argument("zip_path")
    args = parser.parse_args()
    try:
        validate_archive(args.zip_path, args.platform)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"package validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
