use std::io::{self, Read};
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use gamercatch_release_packager::archive::create_release_zip;
use gamercatch_release_packager::checksum::write_sha256sums;
use gamercatch_release_packager::manifest::package_version;
use gamercatch_release_packager::notary::{parse_issue_count, parse_submission};
use gamercatch_release_packager::validation::{Platform, validate_package};

#[derive(Debug, Parser)]
#[command(about = "以 Rust 建立並驗證 GamerCatch 發行包")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// 建立保留 UTF-8 路徑與 Unix 權限的發行 ZIP
    CreateZip {
        source_dir: PathBuf,
        output_zip: PathBuf,
    },
    /// 驗證指定平台的發行 ZIP
    Validate {
        #[arg(long, value_enum)]
        platform: Platform,
        zip_path: PathBuf,
    },
    /// 從標準輸入解析 Apple notarytool submit JSON
    NotarySubmission,
    /// 從標準輸入解析 Apple notarytool log JSON 的 issues 數量
    NotaryIssueCount,
    /// 讀取 Cargo manifest 的 package.version
    PackageVersion { manifest_path: PathBuf },
    /// 依傳入順序建立 SHA256SUMS.txt
    Checksums {
        #[arg(long)]
        output: PathBuf,
        #[arg(required = true)]
        files: Vec<PathBuf>,
    },
}

fn main() {
    if let Err(error) = run() {
        eprintln!("發行包工具失敗：{error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    match Cli::parse().command {
        Command::CreateZip {
            source_dir,
            output_zip,
        } => {
            create_release_zip(&source_dir, &output_zip)?;
            println!("{}", output_zip.display());
        }
        Command::Validate { platform, zip_path } => {
            validate_package(&zip_path, platform)?;
            println!("validated {platform} package: {}", zip_path.display());
        }
        Command::NotarySubmission => {
            let input = read_stdin()?;
            let submission = parse_submission(&input)?;
            println!("{}\t{}", submission.status, submission.id);
        }
        Command::NotaryIssueCount => {
            let input = read_stdin()?;
            println!("{}", parse_issue_count(&input)?);
        }
        Command::PackageVersion { manifest_path } => {
            println!("{}", package_version(&manifest_path)?);
        }
        Command::Checksums { output, files } => {
            write_sha256sums(&files, &output)?;
            println!("{}", output.display());
        }
    }
    Ok(())
}

fn read_stdin() -> Result<String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("無法讀取標準輸入")?;
    Ok(input)
}
