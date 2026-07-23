use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};

pub fn package_version(path: &Path) -> Result<String> {
    let source = fs::read_to_string(path)
        .with_context(|| format!("無法讀取版本 manifest：{}", path.display()))?;
    let version = if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
        json_version(&source, path)?
    } else {
        cargo_version(&source, path)?
    };
    Ok(version)
}

pub fn verify_versions(paths: &[impl AsRef<Path>], expected: &str) -> Result<()> {
    if paths.is_empty() {
        bail!("至少需要一個版本 manifest");
    }
    for path in paths {
        let path = path.as_ref();
        let actual = package_version(path)?;
        if actual != expected {
            bail!(
                "版本不一致：{} 是 {actual}，預期 {expected}",
                path.display()
            );
        }
    }
    Ok(())
}

fn cargo_version(source: &str, path: &Path) -> Result<String> {
    let manifest = toml::from_str::<toml::Value>(source)
        .with_context(|| format!("Cargo manifest 不是有效 TOML：{}", path.display()))?;
    manifest
        .get("package")
        .and_then(|package| package.get("version"))
        .and_then(toml::Value::as_str)
        .with_context(|| format!("Cargo manifest 缺少 package.version：{}", path.display()))
        .map(str::to_owned)
}

fn json_version(source: &str, path: &Path) -> Result<String> {
    let manifest = serde_json::from_str::<serde_json::Value>(source)
        .with_context(|| format!("npm manifest 不是有效 JSON：{}", path.display()))?;
    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("npm manifest 缺少 version：{}", path.display()))
        .map(str::to_owned)?;
    if let Some(lockfile_root) = manifest
        .get("packages")
        .and_then(serde_json::Value::as_object)
        .and_then(|packages| packages.get(""))
    {
        let root_version = lockfile_root
            .get("version")
            .and_then(serde_json::Value::as_str)
            .with_context(|| {
                format!(
                    "npm lockfile 缺少 packages[\"\"].version：{}",
                    path.display()
                )
            })?;
        ensure!(
            root_version == version,
            "npm lockfile 頂層與 packages[\"\"] 版本不一致：{}",
            path.display()
        );
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use anyhow::Result;
    use tempfile::tempdir;

    use super::{package_version, verify_versions};

    #[test]
    fn reads_an_exact_package_version() -> Result<()> {
        let directory = tempdir()?;
        let manifest = directory.path().join("Cargo.toml");
        fs::write(
            &manifest,
            "[package]\nname = \"fixture\"\nversion = \"1.2.3\"\n",
        )?;

        assert_eq!(package_version(&manifest)?, "1.2.3");
        Ok(())
    }

    #[test]
    fn verifies_matching_cargo_and_npm_versions() -> Result<()> {
        let directory = tempdir()?;
        let cargo = directory.path().join("Cargo.toml");
        let npm = directory.path().join("package.json");
        fs::write(
            &cargo,
            "[package]\nname = \"fixture\"\nversion = \"2.3.4\"\n",
        )?;
        fs::write(&npm, r#"{"name":"fixture","version":"2.3.4"}"#)?;

        verify_versions(&[&cargo, &npm], "2.3.4")?;
        assert!(verify_versions(&[&cargo, &npm], "2.3.5").is_err());
        Ok(())
    }

    #[test]
    fn rejects_a_stale_npm_lockfile_root_version() -> Result<()> {
        let directory = tempdir()?;
        let lockfile = directory.path().join("package-lock.json");
        fs::write(
            &lockfile,
            r#"{"version":"2.3.4","packages":{"":{"version":"2.3.3"}}}"#,
        )?;

        assert!(package_version(&lockfile).is_err());
        Ok(())
    }
}
