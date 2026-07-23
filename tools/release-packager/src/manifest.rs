use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};

pub fn package_version(path: &Path) -> Result<String> {
    let source = fs::read_to_string(path)
        .with_context(|| format!("無法讀取 Cargo manifest：{}", path.display()))?;
    let manifest = toml::from_str::<toml::Value>(&source)
        .with_context(|| format!("Cargo manifest 不是有效 TOML：{}", path.display()))?;
    let Some(version) = manifest
        .get("package")
        .and_then(|package| package.get("version"))
        .and_then(toml::Value::as_str)
    else {
        bail!("Cargo manifest 缺少 package.version：{}", path.display());
    };
    Ok(version.to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use anyhow::Result;
    use tempfile::tempdir;

    use super::package_version;

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
}
