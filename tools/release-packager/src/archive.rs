use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use unicode_normalization::UnicodeNormalization;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const UNICODE_REPLACEMENT_CHARACTER: char = '\u{fffd}';
const MAX_ARCHIVE_ENTRIES: usize = 4_096;
const MAX_ENTRY_SIZE: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_SIZE: u64 = 512 * 1024 * 1024;
const UNIX_FILE_TYPE_MASK: u32 = 0o170_000;
const UNIX_DIRECTORY_TYPE: u32 = 0o040_000;
const UNIX_REGULAR_FILE_TYPE: u32 = 0o100_000;

#[derive(Debug)]
pub(crate) struct ScannedZipEntry {
    pub name: String,
    pub is_directory: bool,
    pub unix_mode: Option<u32>,
}

pub fn create_release_zip(source: &Path, output: &Path) -> Result<()> {
    let source = source
        .canonicalize()
        .with_context(|| format!("找不到來源資料夾：{}", source.display()))?;
    ensure!(source.is_dir(), "來源不是資料夾：{}", source.display());
    ensure!(!output.exists(), "輸出已存在：{}", output.display());

    let output = normalized_output_path(output)?;
    ensure!(
        !output.starts_with(&source),
        "輸出 ZIP 不可位於來源資料夾內：{}",
        output.display()
    );
    let output_file = File::options()
        .write(true)
        .create_new(true)
        .open(&output)
        .with_context(|| format!("無法建立輸出 ZIP：{}", output.display()))?;
    let result = write_release_zip(&source, output_file)
        .and_then(|()| validate_created_zip(&source, &output));
    if result.is_err() {
        let _ = fs::remove_file(&output);
    }
    result
}

fn normalized_output_path(output: &Path) -> Result<PathBuf> {
    let filename = output
        .file_name()
        .context("輸出 ZIP 路徑缺少檔名")?
        .to_owned();
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .with_context(|| format!("無法建立輸出資料夾：{}", parent.display()))?;
    let parent = parent
        .canonicalize()
        .with_context(|| format!("無法解析輸出資料夾：{}", parent.display()))?;
    Ok(parent.join(filename))
}

fn write_release_zip(source: &Path, output: File) -> Result<()> {
    let root_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .context("來源資料夾名稱必須是 UTF-8")?;
    validate_entry_name(root_name)?;

    let mut writer = ZipWriter::new(output);
    add_directory(&mut writer, &format!("{root_name}/"), permissions(source)?)?;

    for path in sorted_release_entries(source)? {
        let relative = path
            .strip_prefix(source)
            .context("無法建立來源項目的相對路徑")?;
        let relative = zip_path(relative)?;
        let archive_name = format!("{root_name}/{relative}");
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("無法讀取來源項目：{}", path.display()))?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "發行包不接受符號連結：{}",
            path.display()
        );
        if metadata.is_dir() {
            add_directory(
                &mut writer,
                &format!("{archive_name}/"),
                permissions(&path)?,
            )?;
        } else if metadata.is_file() {
            add_file(&mut writer, &archive_name, &path, permissions(&path)?)?;
        } else {
            bail!("不支援的發行項目：{}", path.display());
        }
    }
    let output = writer.finish().context("無法完成 ZIP central directory")?;
    output.sync_all().context("無法將 ZIP 完整寫入磁碟")?;
    Ok(())
}

fn sorted_release_entries(source: &Path) -> Result<Vec<PathBuf>> {
    let mut pending = vec![source.to_path_buf()];
    let mut entries = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .with_context(|| format!("無法讀取來源資料夾：{}", directory.display()))?
        {
            let path = entry?.path();
            if should_skip(&path) {
                continue;
            }
            if fs::symlink_metadata(&path)?.is_dir() {
                pending.push(path.clone());
            }
            entries.push(path);
        }
    }
    entries.sort_by(|left, right| left.as_os_str().cmp(right.as_os_str()));
    Ok(entries)
}

fn should_skip(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        let name = name.to_string_lossy();
        name == ".DS_Store" || name.starts_with("._")
    })
}

fn add_directory(writer: &mut ZipWriter<File>, name: &str, mode: u32) -> Result<()> {
    validate_entry_name(name)?;
    writer
        .add_directory(name, SimpleFileOptions::default().unix_permissions(mode))
        .with_context(|| format!("無法加入 ZIP 資料夾：{name}"))?;
    Ok(())
}

fn add_file(writer: &mut ZipWriter<File>, name: &str, path: &Path, mode: u32) -> Result<()> {
    validate_entry_name(name)?;
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(9))
        .unix_permissions(mode);
    writer
        .start_file(name, options)
        .with_context(|| format!("無法加入 ZIP 檔案：{name}"))?;
    let mut source =
        File::open(path).with_context(|| format!("無法開啟來源檔案：{}", path.display()))?;
    io::copy(&mut source, writer).with_context(|| format!("無法寫入 ZIP 檔案：{name}"))?;
    Ok(())
}

fn zip_path(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(part) = component else {
            bail!("發行項目包含不安全的路徑元件：{}", path.display());
        };
        parts.push(part.to_str().context("發行項目路徑必須是 UTF-8")?);
    }
    let name = parts.join("/");
    validate_entry_name(&name)?;
    Ok(name)
}

fn validate_created_zip(source: &Path, output: &Path) -> Result<()> {
    let file = File::open(output)?;
    let mut archive = ZipArchive::new(file).context("新 ZIP 無法重新開啟")?;
    let names = scan_zip(&mut archive)?
        .into_iter()
        .map(|entry| entry.name)
        .collect::<HashSet<_>>();

    let root_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .context("來源資料夾名稱必須是 UTF-8")?;
    for entry in fs::read_dir(source)? {
        let name = entry?.file_name();
        let Some(name) = name.to_str() else {
            bail!("來源根目錄包含非 UTF-8 檔名");
        };
        if !name.is_ascii() && !should_skip(&source.join(name)) {
            ensure!(
                names.contains(&format!("{root_name}/{name}"))
                    || names.contains(&format!("{root_name}/{name}/")),
                "UTF-8 檔名未正確寫入 ZIP：{name}"
            );
        }
    }
    Ok(())
}

pub(crate) fn validate_entry_name(name: &str) -> Result<()> {
    ensure!(!name.is_empty(), "ZIP 項目名稱不可為空");
    ensure!(
        !name.contains(UNICODE_REPLACEMENT_CHARACTER),
        "ZIP 項目名稱含 Unicode replacement character：{name:?}"
    );
    ensure!(
        !name.contains('\0') && !name.contains('\\') && !name.chars().any(char::is_control),
        "ZIP 項目名稱含不安全字元：{name:?}"
    );
    ensure!(!name.starts_with('/'), "ZIP 項目不可使用絕對路徑：{name}");
    let without_trailing_slash = name.strip_suffix('/').unwrap_or(name);
    let parts = without_trailing_slash.split('/').collect::<Vec<_>>();
    ensure!(
        !parts.is_empty()
            && parts.iter().all(|part| {
                !part.is_empty()
                    && *part != "."
                    && *part != ".."
                    && !part.ends_with('.')
                    && !part.ends_with(' ')
                    && !part.contains(':')
                    && !part.chars().any(|character| "<>\"|?*".contains(character))
                    && !is_windows_reserved_name(part)
            }),
        "ZIP 項目不可離開根目錄：{name}"
    );
    Ok(())
}

pub(crate) fn portable_name(name: &str) -> String {
    name.trim_end_matches('/')
        .nfc()
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn scan_zip(archive: &mut ZipArchive<File>) -> Result<Vec<ScannedZipEntry>> {
    ensure!(!archive.is_empty(), "ZIP 不可為空");
    ensure!(
        archive.len() <= MAX_ARCHIVE_ENTRIES,
        "ZIP 項目過多：{} > {MAX_ARCHIVE_ENTRIES}",
        archive.len()
    );
    let mut paths = PortablePathSet::default();
    let mut total_size = 0_u64;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_owned();
        validate_entry_name(&name)?;
        ensure!(
            entry.name_raw() == name.as_bytes(),
            "ZIP 項目名稱不是明確的 UTF-8：{name:?}"
        );
        let is_directory = entry.is_dir();
        validate_entry_type(&entry, &name, is_directory)?;
        paths.insert(&name, is_directory)?;
        if !is_directory {
            ensure!(entry.size() <= MAX_ENTRY_SIZE, "ZIP 項目解壓後過大：{name}");
            total_size = total_size
                .checked_add(entry.size())
                .context("ZIP 解壓總大小溢位")?;
            ensure!(total_size <= MAX_ARCHIVE_SIZE, "ZIP 解壓總大小超過安全上限");
            io::copy(&mut entry, &mut io::sink())
                .with_context(|| format!("ZIP CRC 驗證失敗：{name}"))?;
        }
        entries.push(ScannedZipEntry {
            name,
            is_directory,
            unix_mode: entry.unix_mode(),
        });
    }
    Ok(entries)
}

fn validate_entry_type<R: Read>(
    entry: &zip::read::ZipFile<'_, R>,
    name: &str,
    is_directory: bool,
) -> Result<()> {
    ensure!(!entry.encrypted(), "ZIP 項目不可加密：{name}");
    ensure!(!entry.is_symlink(), "ZIP 項目不可為符號連結：{name}");
    if is_directory {
        ensure!(entry.size() == 0, "ZIP 資料夾項目不可包含資料：{name}");
    }
    let Some(mode) = entry.unix_mode() else {
        return Ok(());
    };
    let file_type = mode & UNIX_FILE_TYPE_MASK;
    let expected_type = if is_directory {
        UNIX_DIRECTORY_TYPE
    } else {
        UNIX_REGULAR_FILE_TYPE
    };
    ensure!(
        file_type == 0 || file_type == expected_type,
        "ZIP 項目使用不支援的檔案類型：{name}"
    );
    Ok(())
}

fn is_windows_reserved_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || has_reserved_numeric_suffix(&stem, "COM")
        || has_reserved_numeric_suffix(&stem, "LPT")
}

fn has_reserved_numeric_suffix(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

#[derive(Default)]
struct PortablePathSet {
    entries: HashMap<String, bool>,
}

impl PortablePathSet {
    fn insert(&mut self, name: &str, is_directory: bool) -> Result<()> {
        let key = portable_name(name);
        ensure!(
            !self.entries.contains_key(&key),
            "ZIP 內有跨平台會衝突的項目：{name}"
        );
        self.ensure_ancestors_are_directories(&key, name)?;
        if !is_directory {
            let child_prefix = format!("{key}/");
            ensure!(
                !self
                    .entries
                    .keys()
                    .any(|existing| existing.starts_with(&child_prefix)),
                "ZIP 檔案與既有子項目衝突：{name}"
            );
        }
        self.entries.insert(key, is_directory);
        Ok(())
    }

    fn ensure_ancestors_are_directories(&self, key: &str, name: &str) -> Result<()> {
        let mut ancestor = String::new();
        let mut components = key.split('/').peekable();
        while let Some(component) = components.next() {
            if components.peek().is_none() {
                break;
            }
            if !ancestor.is_empty() {
                ancestor.push('/');
            }
            ancestor.push_str(component);
            ensure!(
                self.entries.get(&ancestor) != Some(&false),
                "ZIP 項目的上層路徑是檔案：{name}"
            );
        }
        Ok(())
    }
}

#[cfg(unix)]
fn permissions(path: &Path) -> Result<u32> {
    use std::os::unix::fs::PermissionsExt;

    Ok(fs::metadata(path)?.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn permissions(path: &Path) -> Result<u32> {
    Ok(if path.is_dir() { 0o755 } else { 0o644 })
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::{Read, Write};

    use anyhow::Result;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    use super::{create_release_zip, scan_zip, validate_entry_name};

    #[test]
    fn creates_a_clean_unicode_archive_with_an_empty_directory() -> Result<()> {
        let temporary = tempdir()?;
        let source = temporary.path().join("GamerCatch-test");
        fs::create_dir_all(source.join("credentials"))?;
        fs::write(source.join("使用說明.txt"), "安全說明")?;
        fs::write(source.join(".DS_Store"), "metadata")?;
        fs::write(source.join("._使用說明.txt"), "metadata")?;
        let output = temporary.path().join("release.zip");

        create_release_zip(&source, &output)?;

        let mut archive = ZipArchive::new(fs::File::open(output)?)?;
        assert!(archive.by_name("GamerCatch-test/credentials/").is_ok());
        let mut usage = String::new();
        archive
            .by_name("GamerCatch-test/使用說明.txt")?
            .read_to_string(&mut usage)?;
        assert_eq!(usage, "安全說明");
        assert!(archive.by_name("GamerCatch-test/.DS_Store").is_err());
        assert!(archive.by_name("GamerCatch-test/._使用說明.txt").is_err());
        Ok(())
    }

    #[test]
    fn refuses_to_overwrite_an_existing_archive() -> Result<()> {
        let temporary = tempdir()?;
        let source = temporary.path().join("source");
        fs::create_dir(&source)?;
        let output = temporary.path().join("release.zip");
        fs::write(&output, "keep")?;

        assert!(create_release_zip(&source, &output).is_err());
        assert_eq!(fs::read_to_string(output)?, "keep");
        Ok(())
    }

    #[test]
    fn writes_reproducible_archive_bytes() -> Result<()> {
        let temporary = tempdir()?;
        let source = temporary.path().join("source");
        fs::create_dir(&source)?;
        fs::write(source.join("data.txt"), "same input")?;
        let first = temporary.path().join("first.zip");
        let second = temporary.path().join("second.zip");

        create_release_zip(&source, &first)?;
        create_release_zip(&source, &second)?;

        assert_eq!(fs::read(first)?, fs::read(second)?);
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn preserves_executable_permissions() -> Result<()> {
        use std::os::unix::fs::PermissionsExt;

        let temporary = tempdir()?;
        let source = temporary.path().join("source");
        fs::create_dir(&source)?;
        let executable = source.join("run.command");
        fs::write(&executable, "#!/bin/sh\n")?;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))?;
        let output = temporary.path().join("release.zip");

        create_release_zip(&source, &output)?;

        let mut archive = ZipArchive::new(fs::File::open(output)?)?;
        assert_eq!(
            archive
                .by_name("source/run.command")?
                .unix_mode()
                .unwrap_or_default()
                & 0o777,
            0o755
        );
        Ok(())
    }

    #[test]
    fn rejects_nonportable_windows_paths() {
        for name in [
            "root/file:stream",
            "root/CON.txt",
            "root/LPT9",
            "root/question?.txt",
            "root/trailing. ",
        ] {
            assert!(validate_entry_name(name).is_err(), "accepted {name}");
        }
    }

    #[test]
    fn rejects_symlinks_directory_payloads_and_file_tree_collisions() -> Result<()> {
        assert!(
            scan_fixture_zip(|writer| {
                writer.add_symlink("root/link", "../outside", SimpleFileOptions::default())?;
                Ok(())
            })
            .is_err()
        );

        assert!(
            scan_fixture_zip(|writer| {
                writer.start_file("root/directory/", SimpleFileOptions::default())?;
                writer.write_all(b"unexpected payload")?;
                Ok(())
            })
            .is_err()
        );

        assert!(
            scan_fixture_zip(|writer| {
                writer.start_file("root/conflict", SimpleFileOptions::default())?;
                writer.write_all(b"file")?;
                writer.add_directory("root/conflict/", SimpleFileOptions::default())?;
                Ok(())
            })
            .is_err()
        );
        Ok(())
    }

    fn scan_fixture_zip(
        write_entries: impl FnOnce(&mut ZipWriter<File>) -> zip::result::ZipResult<()>,
    ) -> Result<()> {
        let temporary = tempdir()?;
        let path = temporary.path().join("fixture.zip");
        let mut writer = ZipWriter::new(File::create(&path)?);
        writer.add_directory("root/", SimpleFileOptions::default())?;
        write_entries(&mut writer)?;
        writer.finish()?;

        let mut archive = ZipArchive::new(File::open(path)?)?;
        scan_zip(&mut archive)?;
        Ok(())
    }
}
