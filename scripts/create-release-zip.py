#!/usr/bin/env python3
"""Create a clean, UTF-8 release ZIP while preserving executable modes."""

from __future__ import annotations

import argparse
import stat
import zipfile
from pathlib import Path, PurePosixPath


UNICODE_REPLACEMENT_CHARACTER = "\uFFFD"


def should_skip(path: Path) -> bool:
    return path.name == ".DS_Store" or path.name.startswith("._")


def add_directory(archive: zipfile.ZipFile, arcname: str, mode: int) -> None:
    info = zipfile.ZipInfo(arcname.rstrip("/") + "/")
    info.create_system = 3
    info.external_attr = ((stat.S_IFDIR | mode) & 0xFFFF) << 16
    info.compress_type = zipfile.ZIP_STORED
    archive.writestr(info, b"")


def archive_name(source: Path, root_name: str, path: Path) -> str:
    relative = path.relative_to(source)
    return (PurePosixPath(root_name) / PurePosixPath(relative.as_posix())).as_posix()


def add_release_entry(
    archive: zipfile.ZipFile,
    source: Path,
    root_name: str,
    path: Path,
) -> None:
    arcname = archive_name(source, root_name, path)
    if path.is_dir():
        add_directory(archive, arcname, path.stat().st_mode & 0o777)
        return
    if path.is_file():
        archive.write(path, arcname)
        return
    raise ValueError(f"unsupported release entry: {path}")


def is_invalid_entry_name(name: str) -> bool:
    path = PurePosixPath(name)
    return UNICODE_REPLACEMENT_CHARACTER in name or path.is_absolute() or ".." in path.parts


def validate_zip(source: Path, output: Path) -> None:
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        if archive.testzip() is not None:
            raise ValueError("new ZIP failed its CRC check")
        for name in names:
            if is_invalid_entry_name(name):
                raise ValueError(f"invalid ZIP entry name: {name!r}")

        expected_unicode = [
            path.name
            for path in source.iterdir()
            if any(ord(char) > 127 for char in path.name)
        ]
        for filename in expected_unicode:
            if not any(name.endswith(f"/{filename}") for name in names):
                raise ValueError(f"UTF-8 filename did not round-trip: {filename}")


def create_zip(source: Path, output: Path) -> None:
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError(f"source is not a directory: {source}")
    if output.exists():
        raise ValueError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    root_name = source.name
    with zipfile.ZipFile(
        output,
        mode="x",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        allowZip64=True,
    ) as archive:
        add_directory(archive, root_name, source.stat().st_mode & 0o777)
        for path in sorted(source.rglob("*"), key=lambda item: item.as_posix()):
            if should_skip(path):
                continue
            add_release_entry(archive, source, root_name, path)

    validate_zip(source, output)

    print(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_zip", type=Path)
    args = parser.parse_args()
    create_zip(args.source_dir, args.output_zip)


if __name__ == "__main__":
    main()
