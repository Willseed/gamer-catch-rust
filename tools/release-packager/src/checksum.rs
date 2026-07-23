use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::Path;

use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};

pub fn write_sha256sums(files: &[impl AsRef<Path>], output: &Path) -> Result<()> {
    ensure!(!files.is_empty(), "至少需要一個檔案才能建立 checksum");
    ensure!(
        !output.exists(),
        "checksum 輸出已存在：{}",
        output.display()
    );
    let mut destination = File::options()
        .write(true)
        .create_new(true)
        .open(output)
        .with_context(|| format!("無法建立 checksum：{}", output.display()))?;
    let result = write_checksums(files, &mut destination).and_then(|()| {
        destination
            .sync_all()
            .context("無法將 checksum 完整寫入磁碟")
    });
    if result.is_err() {
        let _ = fs::remove_file(output);
    }
    result
}

fn write_checksums(files: &[impl AsRef<Path>], destination: &mut File) -> Result<()> {
    for file in files {
        let path = file.as_ref();
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .context("checksum 檔名必須是 UTF-8")?;
        ensure!(
            !filename.contains(['\r', '\n']),
            "checksum 檔名不可包含換行"
        );
        let digest = sha256(path)?;
        for byte in digest {
            write!(destination, "{byte:02x}")?;
        }
        writeln!(destination, "  {filename}")?;
    }
    Ok(())
}

fn sha256(path: &Path) -> Result<[u8; 32]> {
    let file =
        File::open(path).with_context(|| format!("無法讀取 checksum 來源：{}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use anyhow::Result;
    use tempfile::tempdir;

    use super::write_sha256sums;

    #[test]
    fn writes_standard_ordered_sha256_lines_without_overwriting() -> Result<()> {
        let temporary = tempdir()?;
        let first = temporary.path().join("first.zip");
        let second = temporary.path().join("second.zip");
        let output = temporary.path().join("SHA256SUMS.txt");
        fs::write(&first, "abc")?;
        fs::write(&second, "")?;

        write_sha256sums(&[&first, &second], &output)?;

        assert_eq!(
            fs::read_to_string(&output)?,
            concat!(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  first.zip\n",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  second.zip\n"
            )
        );
        assert!(write_sha256sums(&[&first], &output).is_err());
        Ok(())
    }
}
