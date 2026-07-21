#!/usr/bin/env python3
"""Validate a GamerCatch release ZIP using only the Python standard library."""

from __future__ import annotations

import argparse
import io
import re
import sys
import tomllib
import zipfile
from pathlib import PurePosixPath


COMMON_REQUIRED = {
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "使用說明.txt",
    "config.example.toml",
    "config.toml",
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
        rb"(?:/Users/[^/\x00]+/|/home/runner/work/|[A-Za-z]:\\Users\\[^\\\x00]+\\|[A-Za-z]:\\a\\)",
        re.IGNORECASE,
    )
    match = local_path.search(data)
    if match:
        display = match.group(0).decode("utf-8", errors="replace")
        fail(f"executable leaks a local build path: {display}")


def validate_archive(path: str, platform: str) -> None:
    executable = "GamerCatch" if platform == "macos" else "GamerCatch.exe"
    driver_node = "playwright-driver/node" if platform == "macos" else "playwright-driver/node.exe"
    starter = "1_首次設定.command" if platform == "macos" else "1_首次設定.cmd"
    runner = "2_開始抓取.command" if platform == "macos" else "2_開始抓取.cmd"
    manual = (
        "GamerCatch_零基礎使用手冊_macOS.pdf"
        if platform == "macos"
        else "GamerCatch_零基礎使用手冊_Windows.pdf"
    )

    with zipfile.ZipFile(path) as archive:
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

        for required in COMMON_REQUIRED | {executable, starter, runner, manual}:
            read_required(archive, entries, required)
        read_required(archive, entries, driver_node)
        read_required(archive, entries, "playwright-driver/package/cli.js")

        config_data = read_required(archive, entries, "config.toml")
        validate_config(config_data)
        manual_data = read_required(archive, entries, manual)
        if not manual_data.startswith(b"%PDF-") or b"%%EOF" not in manual_data[-2048:]:
            fail(f"manual is not a complete PDF: {manual}")

        executable_data = read_required(archive, entries, executable)
        validate_no_local_build_paths(executable_data)
        driver_data = read_required(archive, entries, driver_node)
        if platform == "windows":
            if not executable_data.startswith(b"MZ") or not driver_data.startswith(b"MZ"):
                fail("Windows executable or bundled Node is not a PE file")
        else:
            macho_magics = {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}
            if executable_data[:4] not in macho_magics or driver_data[:4] not in macho_magics:
                fail("macOS executable or bundled Node is not a Mach-O file")
            for required_executable in [executable, driver_node, starter, runner]:
                info = archive.getinfo(matching_entry(entries, required_executable))
                mode = (info.external_attr >> 16) & 0o777
                if mode & 0o111 == 0:
                    fail(f"macOS release entry is not executable: {required_executable}")

        credential_files = [
            entry
            for entry in entries
            if "/credentials/" in f"/{entry}" and entry.lower().endswith(".json")
        ]
        if credential_files:
            fail(f"release ZIP must not contain credential JSON files: {credential_files}")

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
