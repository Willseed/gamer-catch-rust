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
CREDENTIALS_DIRECTORY = "credentials"
WINDOWS_SCHEDULER_ENTRY = "3_安裝每天早上9點自動抓取.cmd"
WINDOWS_SCHEDULER_SCRIPT = "install-windows-task.ps1"

COMMON_REQUIRED = {
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "使用說明.txt",
    "config.example.toml",
    CONFIG_FILENAME,
}


@dataclass(frozen=True)
class PlatformFiles:
    executable: str
    driver_node: str
    starter: str
    runner: str
    manual: str
    extra_required: tuple[str, ...] = ()


PLATFORM_FILES = {
    "macos": PlatformFiles(
        executable="GamerCatch",
        driver_node="playwright-driver/node",
        starter="1_首次設定.command",
        runner="2_開始抓取.command",
        manual="GamerCatch_零基礎使用手冊_macOS.pdf",
    ),
    "windows": PlatformFiles(
        executable="GamerCatch.exe",
        driver_node="playwright-driver/node.exe",
        starter="1_首次設定.cmd",
        runner="2_開始抓取.cmd",
        manual="GamerCatch_零基礎使用手冊_Windows.pdf",
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


def validate_config(data: bytes) -> None:
    try:
        config = tomllib.load(io.BytesIO(data))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as error:
        fail(f"config.toml is invalid: {error}")
    if config.get("schema_version") != 2:
        fail("config.toml must use schema_version = 2")
    games = config.get("games")
    if not isinstance(games, list) or len(games) < 3:
        fail("config.toml must contain at least three beginner game slots")
    if sum(bool(game.get("enabled")) for game in games) != 1:
        fail("safe example must enable exactly one game")
    if any(bool(game.get("write_to_google_sheets")) for game in games):
        fail("safe example must disable all Google Sheets writes")
    if any("private_key" in str(game) for game in games):
        fail("config.toml unexpectedly contains private-key material")


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

    for entry in entries:
        parsed = PurePosixPath(entry)
        if parsed.is_absolute() or ".." in parsed.parts:
            fail(f"unsafe ZIP path: {entry}")
    return entries


def validate_required_files(
    archive: zipfile.ZipFile, entries: list[str], files: PlatformFiles
) -> tuple[bytes, bytes]:
    existence_only = (COMMON_REQUIRED - {CONFIG_FILENAME}) | {
        files.starter,
        files.runner,
        "playwright-driver/package/cli.js",
    } | set(files.extra_required)
    for required in existence_only:
        read_required(archive, entries, required)

    validate_config(read_required(archive, entries, CONFIG_FILENAME))
    validate_manual(read_required(archive, entries, files.manual), files.manual)
    return (
        read_required(archive, entries, files.executable),
        read_required(archive, entries, files.driver_node),
    )


def validate_manual(data: bytes, name: str) -> None:
    if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
        fail(f"manual is not a complete PDF: {name}")


def require_markers(text: str, markers: tuple[str, ...], name: str) -> None:
    missing = [marker for marker in markers if marker not in text]
    if missing:
        fail(f"{name} is missing required scheduler markers: {missing}")


def validate_windows_scheduler(
    archive: zipfile.ZipFile, entries: list[str]
) -> None:
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

    entry_data = read_required(archive, entries, WINDOWS_SCHEDULER_ENTRY)
    try:
        entry = entry_data.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"{WINDOWS_SCHEDULER_ENTRY} is not UTF-8: {error}")
    require_markers(
        entry,
        (WINDOWS_SCHEDULER_SCRIPT, "-ExecutionPolicy Bypass"),
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
    ]
    for required in required_executables:
        info = archive.getinfo(matching_entry(entries, required))
        mode = (info.external_attr >> 16) & 0o777
        if mode & 0o111 == 0:
            fail(f"macOS release entry is not executable: {required}")


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
