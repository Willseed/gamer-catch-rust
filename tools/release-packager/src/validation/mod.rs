mod config;
mod scripts;

use std::collections::HashSet;
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use clap::ValueEnum;
use regex::bytes::Regex;
use zip::ZipArchive;

use crate::archive::scan_zip;
use config::validate_example_config;
use scripts::{
    validate_macos_gmail_authorizer, validate_macos_runner, validate_macos_starter,
    validate_windows_scripts,
};

pub(super) const CONFIG_FILENAME: &str = "config.toml";
pub(super) const EXAMPLE_CONFIG_FILENAME: &str = "config.example.toml";
pub(super) const CREDENTIALS_DIRECTORY: &str = "credentials";
pub(super) const USAGE_FILENAME: &str = "使用說明.txt";
pub(super) const WEB_GUIDE_URL: &str = "https://gamer-catch.pylot.dev/guide#quick-start";
pub(super) const CONFIG_GENERATOR_URL: &str = "https://gamer-catch.pylot.dev/generator";
pub(super) const WINDOWS_STARTER_ENTRY: &str = "1_首次設定.cmd";
pub(super) const WINDOWS_RUNNER_ENTRY: &str = "2_開始抓取.cmd";
pub(super) const WINDOWS_GMAIL_AUTHORIZER_ENTRY: &str = "Gmail_首次授權.cmd";
pub(super) const WINDOWS_SCHEDULER_ENTRY: &str = "3_安裝每天早上9點自動抓取.cmd";
pub(super) const WINDOWS_SCHEDULER_SCRIPT: &str = "install-windows-task.ps1";

const COMMON_REQUIRED: &[&str] = &[
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    USAGE_FILENAME,
    EXAMPLE_CONFIG_FILENAME,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum Platform {
    Macos,
    Windows,
}

impl fmt::Display for Platform {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Macos => formatter.write_str("macos"),
            Self::Windows => formatter.write_str("windows"),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PlatformFiles {
    executable: &'static str,
    driver_node: &'static str,
    starter: &'static str,
    runner: &'static str,
    gmail_authorizer: &'static str,
    extra_required: &'static [&'static str],
}

impl PlatformFiles {
    fn for_platform(platform: Platform) -> Self {
        match platform {
            Platform::Macos => Self {
                executable: "GamerCatch",
                driver_node: "playwright-driver/node",
                starter: "1_首次設定.command",
                runner: "2_開始抓取.command",
                gmail_authorizer: "Gmail_首次授權.command",
                extra_required: &[],
            },
            Platform::Windows => Self {
                executable: "GamerCatch.exe",
                driver_node: "playwright-driver/node.exe",
                starter: WINDOWS_STARTER_ENTRY,
                runner: WINDOWS_RUNNER_ENTRY,
                gmail_authorizer: WINDOWS_GMAIL_AUTHORIZER_ENTRY,
                extra_required: &[WINDOWS_SCHEDULER_ENTRY, WINDOWS_SCHEDULER_SCRIPT],
            },
        }
    }
}

#[derive(Debug)]
struct ArchiveEntry {
    name: String,
    is_directory: bool,
    unix_mode: Option<u32>,
}

pub(super) struct PackageArchive {
    archive: ZipArchive<File>,
    entries: Vec<ArchiveEntry>,
    root: String,
}

impl PackageArchive {
    fn open(path: &Path) -> Result<Self> {
        let file =
            File::open(path).with_context(|| format!("無法開啟發行 ZIP：{}", path.display()))?;
        let mut archive =
            ZipArchive::new(file).with_context(|| format!("不是有效的 ZIP：{}", path.display()))?;
        let entries = scan_zip(&mut archive)?
            .into_iter()
            .map(|entry| ArchiveEntry {
                name: entry.name,
                is_directory: entry.is_directory,
                unix_mode: entry.unix_mode,
            })
            .collect::<Vec<_>>();
        let root = validate_structure(&entries)?;
        Ok(Self {
            archive,
            entries,
            root,
        })
    }

    pub(super) fn read_required(&mut self, suffix: &str) -> Result<Vec<u8>> {
        let name = self.matching_entry(suffix, false)?.to_owned();
        let mut entry = self.archive.by_name(&name)?;
        let mut data = Vec::with_capacity(entry.size().try_into().unwrap_or_default());
        entry
            .read_to_end(&mut data)
            .with_context(|| format!("無法讀取必要檔案：{name}"))?;
        ensure!(!data.is_empty(), "必要檔案是空的：{name}");
        Ok(data)
    }

    fn matching_entry(&self, suffix: &str, directory: bool) -> Result<&str> {
        let expected_parts = path_parts(suffix);
        let matches = self
            .entries
            .iter()
            .filter(|entry| entry.is_directory == directory)
            .filter(|entry| {
                let parts = path_parts(&entry.name);
                parts.len() == expected_parts.len() + 1 && parts[1..] == expected_parts
            })
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        ensure!(
            matches.len() == 1,
            "必要項目 {suffix:?} 應正好出現一次，實際為：{matches:?}"
        );
        Ok(matches[0])
    }

    pub(super) fn executable_mode(&self, suffix: &str) -> Result<u32> {
        let name = self.matching_entry(suffix, false)?;
        self.entries
            .iter()
            .find(|entry| entry.name == name)
            .and_then(|entry| entry.unix_mode)
            .context(format!("ZIP 項目缺少 Unix mode：{name}"))
    }

    fn validate_empty_credentials_directory(&self) -> Result<()> {
        let directory_name = format!("{}/{CREDENTIALS_DIRECTORY}/", self.root);
        let directory = self
            .entries
            .iter()
            .find(|entry| entry.name == directory_name)
            .context(format!("發行 ZIP 缺少空的 {CREDENTIALS_DIRECTORY}/ 資料夾"))?;
        ensure!(
            directory.is_directory,
            "ZIP 項目不是資料夾：{directory_name}"
        );
        let credential_files = self
            .entries
            .iter()
            .filter(|entry| entry.name.starts_with(&directory_name) && !entry.is_directory)
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        ensure!(
            credential_files.is_empty(),
            "credentials 資料夾必須是空的：{credential_files:?}"
        );
        Ok(())
    }
}

pub fn validate_package(path: &Path, platform: Platform) -> Result<()> {
    let files = PlatformFiles::for_platform(platform);
    let mut archive = PackageArchive::open(path)?;
    let (executable, driver) = validate_required_files(&mut archive, files)?;
    validate_no_local_build_paths(&executable)?;
    validate_binary_format(&executable, &driver, platform)?;
    match platform {
        Platform::Macos => validate_macos_package(&mut archive, files)?,
        Platform::Windows => validate_windows_scripts(&mut archive)?,
    }
    archive.validate_empty_credentials_directory()?;
    Ok(())
}

fn validate_structure(entries: &[ArchiveEntry]) -> Result<String> {
    ensure!(
        entries.iter().any(|entry| !entry.is_directory),
        "ZIP 不包含任何檔案"
    );
    let roots = entries
        .iter()
        .map(|entry| path_parts(&entry.name)[0].to_owned())
        .collect::<HashSet<_>>();
    ensure!(
        roots.len() == 1,
        "ZIP 必須只有一個頂層資料夾，實際為：{roots:?}"
    );
    let root = roots.into_iter().next().context("ZIP 缺少頂層資料夾")?;
    ensure!(
        entries
            .iter()
            .any(|entry| entry.is_directory && entry.name == format!("{root}/")),
        "ZIP 缺少明確的頂層資料夾項目：{root}/"
    );
    for entry in entries.iter().filter(|entry| !entry.is_directory) {
        validate_release_entry(&entry.name)?;
    }
    let toml_entries = entries
        .iter()
        .filter(|entry| !entry.is_directory && entry.name.to_ascii_lowercase().ends_with(".toml"))
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    ensure!(
        toml_entries.len() == 1
            && Path::new(toml_entries[0])
                .file_name()
                .and_then(|name| name.to_str())
                == Some(EXAMPLE_CONFIG_FILENAME),
        "發行 ZIP 必須只包含一份 {EXAMPLE_CONFIG_FILENAME}：{toml_entries:?}"
    );
    Ok(root)
}

fn validate_release_entry(name: &str) -> Result<()> {
    let filename = name.rsplit('/').next().unwrap_or(name);
    ensure!(
        filename != CONFIG_FILENAME,
        "發行 ZIP 不可包含會被覆寫的 {CONFIG_FILENAME}；請由設定產生器下載：{name}"
    );
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".toml") {
        ensure!(
            filename == EXAMPLE_CONFIG_FILENAME,
            "發行 ZIP 只能包含 {EXAMPLE_CONFIG_FILENAME}：{name}"
        );
    }
    ensure!(
        !lower.ends_with(".pdf"),
        "發行 ZIP 必須使用線上教學，不可包含 PDF：{name}"
    );
    Ok(())
}

fn validate_required_files(
    archive: &mut PackageArchive,
    files: PlatformFiles,
) -> Result<(Vec<u8>, Vec<u8>)> {
    for required in COMMON_REQUIRED
        .iter()
        .copied()
        .chain([
            files.starter,
            files.runner,
            files.gmail_authorizer,
            "playwright-driver/package/cli.js",
        ])
        .chain(files.extra_required.iter().copied())
    {
        if required == EXAMPLE_CONFIG_FILENAME || required == USAGE_FILENAME {
            continue;
        }
        archive.read_required(required)?;
    }

    validate_example_config(&archive.read_required(EXAMPLE_CONFIG_FILENAME)?)?;
    let usage = scripts::decode_utf8(archive.read_required(USAGE_FILENAME)?, USAGE_FILENAME)?;
    scripts::require_markers(&usage, &[WEB_GUIDE_URL], USAGE_FILENAME)?;
    Ok((
        archive.read_required(files.executable)?,
        archive.read_required(files.driver_node)?,
    ))
}

fn validate_no_local_build_paths(data: &[u8]) -> Result<()> {
    let pattern = Regex::new(
        r"(?i)(?:/Users/[^/\x00]+/|/home/runner/work/|[A-Z]:\\Users\\[^\\\x00]+\\|[A-Z]:\\a\\)",
    )?;
    if let Some(found) = pattern.find(data) {
        bail!(
            "執行檔洩漏本機建置路徑：{}",
            String::from_utf8_lossy(found.as_bytes())
        );
    }
    Ok(())
}

fn validate_binary_format(executable: &[u8], driver: &[u8], platform: Platform) -> Result<()> {
    match platform {
        Platform::Windows => ensure!(
            executable.starts_with(b"MZ") && driver.starts_with(b"MZ"),
            "Windows 主程式或隨附 Node 不是 PE 檔"
        ),
        Platform::Macos => {
            const MACHO_MAGICS: [[u8; 4]; 3] = [
                [0xcf, 0xfa, 0xed, 0xfe],
                [0xca, 0xfe, 0xba, 0xbe],
                [0xca, 0xfe, 0xba, 0xbf],
            ];
            ensure!(
                executable.get(..4).is_some_and(|magic| {
                    MACHO_MAGICS
                        .iter()
                        .any(|candidate| candidate.as_slice() == magic)
                }) && driver.get(..4).is_some_and(|magic| {
                    MACHO_MAGICS
                        .iter()
                        .any(|candidate| candidate.as_slice() == magic)
                }),
                "macOS 主程式或隨附 Node 不是 Mach-O 檔"
            );
        }
    }
    Ok(())
}

fn validate_macos_package(archive: &mut PackageArchive, files: PlatformFiles) -> Result<()> {
    for required in [
        files.executable,
        files.driver_node,
        files.starter,
        files.runner,
        files.gmail_authorizer,
    ] {
        ensure!(
            archive.executable_mode(required)? & 0o111 != 0,
            "macOS 發行項目沒有執行權限：{required}"
        );
    }
    validate_macos_gmail_authorizer(archive, files)?;
    validate_macos_runner(archive, files)?;
    validate_macos_starter(archive, files)?;
    Ok(())
}

fn path_parts(path: &str) -> Vec<&str> {
    path.trim_end_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use anyhow::{Context, Result};
    use tempfile::{TempDir, tempdir};

    use super::{
        Platform, validate_binary_format, validate_no_local_build_paths, validate_package,
    };
    use crate::archive::create_release_zip;

    #[test]
    fn rejects_local_build_paths_in_release_binaries() {
        assert!(validate_no_local_build_paths(b"prefix /Users/pony/repo suffix").is_err());
        assert!(validate_no_local_build_paths(br"prefix D:\a\repo suffix").is_err());
        assert!(validate_no_local_build_paths(b"portable /workspace/repo").is_ok());
    }

    #[test]
    fn validates_platform_binary_magics() {
        assert!(validate_binary_format(b"MZapp", b"MZnode", Platform::Windows).is_ok());
        assert!(validate_binary_format(b"ELF", b"MZnode", Platform::Windows).is_err());
        let macho = [0xcf, 0xfa, 0xed, 0xfe, 1];
        assert!(validate_binary_format(&macho, &macho, Platform::Macos).is_ok());
    }

    #[test]
    fn validates_a_complete_windows_release_fixture() -> Result<()> {
        let fixture = ReleaseFixture::new(Platform::Windows)?;
        fixture.create_and_validate()
    }

    #[cfg(unix)]
    #[test]
    fn validates_a_complete_macos_release_fixture() -> Result<()> {
        let fixture = ReleaseFixture::new(Platform::Macos)?;
        fixture.create_and_validate()
    }

    #[test]
    fn rejects_mutable_config_and_nonempty_credentials() -> Result<()> {
        let mutable_config = ReleaseFixture::new(Platform::Windows)?;
        fs::write(
            mutable_config.source.join("config.toml"),
            "schema_version = 2\n",
        )?;
        assert!(mutable_config.create_and_validate().is_err());

        let leaked_credential = ReleaseFixture::new(Platform::Windows)?;
        fs::write(
            leaked_credential.source.join("credentials/secret.json"),
            "{}",
        )?;
        assert!(leaked_credential.create_and_validate().is_err());
        Ok(())
    }

    struct ReleaseFixture {
        _temporary: TempDir,
        source: PathBuf,
        output: PathBuf,
        platform: Platform,
    }

    impl ReleaseFixture {
        fn new(platform: Platform) -> Result<Self> {
            let temporary = tempdir()?;
            let source = temporary.path().join("GamerCatch-fixture");
            let output = temporary.path().join("release.zip");
            fs::create_dir_all(source.join("credentials"))?;
            fs::create_dir_all(source.join("playwright-driver/package"))?;
            copy_common_files(&source)?;
            fs::write(source.join("playwright-driver/package/cli.js"), "fixture")?;
            match platform {
                Platform::Macos => prepare_macos_files(&source)?,
                Platform::Windows => prepare_windows_files(&source)?,
            }
            Ok(Self {
                _temporary: temporary,
                source,
                output,
                platform,
            })
        }

        fn create_and_validate(&self) -> Result<()> {
            create_release_zip(&self.source, &self.output)?;
            validate_package(&self.output, self.platform)
        }
    }

    fn repository_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    fn copy_common_files(destination: &Path) -> Result<()> {
        for path in [
            "README.md",
            "LICENSE",
            "THIRD_PARTY_NOTICES.md",
            "使用說明.txt",
            "config.example.toml",
        ] {
            copy_repository_file(path, &destination.join(path))?;
        }
        Ok(())
    }

    fn prepare_windows_files(destination: &Path) -> Result<()> {
        fs::write(destination.join("GamerCatch.exe"), b"MZfixture")?;
        fs::write(destination.join("playwright-driver/node.exe"), b"MZfixture")?;
        for path in [
            "1_首次設定.cmd",
            "2_開始抓取.cmd",
            "Gmail_首次授權.cmd",
            "3_安裝每天早上9點自動抓取.cmd",
        ] {
            copy_cmd_with_crlf(path, destination)?;
        }
        copy_repository_file(
            "scripts/install-windows-task.ps1",
            &destination.join("install-windows-task.ps1"),
        )
    }

    #[cfg(unix)]
    fn prepare_macos_files(destination: &Path) -> Result<()> {
        use std::os::unix::fs::PermissionsExt;

        let macho = [0xcf, 0xfa, 0xed, 0xfe, 1];
        fs::write(destination.join("GamerCatch"), macho)?;
        fs::write(destination.join("playwright-driver/node"), macho)?;
        for path in [
            "1_首次設定.command",
            "2_開始抓取.command",
            "Gmail_首次授權.command",
        ] {
            copy_repository_file(&format!("scripts/{path}"), &destination.join(path))?;
        }
        for path in [
            destination.join("GamerCatch"),
            destination.join("playwright-driver/node"),
            destination.join("1_首次設定.command"),
            destination.join("2_開始抓取.command"),
            destination.join("Gmail_首次授權.command"),
        ] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn prepare_macos_files(_destination: &Path) -> Result<()> {
        anyhow::bail!("macOS fixture requires Unix permission support")
    }

    fn copy_cmd_with_crlf(name: &str, destination: &Path) -> Result<()> {
        let source = repository_root().join("scripts").join(name);
        let content = fs::read_to_string(&source)
            .with_context(|| format!("無法讀取測試 CMD：{}", source.display()))?;
        let normalized = content.replace("\r\n", "\n").replace('\n', "\r\n");
        fs::write(destination.join(name), normalized)?;
        Ok(())
    }

    fn copy_repository_file(source: &str, destination: &Path) -> Result<()> {
        let source = repository_root().join(source);
        fs::copy(&source, destination)
            .with_context(|| format!("無法複製測試檔案：{}", source.display()))?;
        Ok(())
    }
}
