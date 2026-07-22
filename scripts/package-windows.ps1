$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$DriverCache = Join-Path $ProjectDir "target\playwright-driver-cache"
$CargoHomeDir = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$RustFlagSeparator = [char]0x1f
$ProjectDirForward = $ProjectDir.Replace('\', '/')
$CargoHomeDirForward = $CargoHomeDir.Replace('\', '/')
$RemapFlags = @(
    "--remap-path-prefix=$ProjectDir=/workspace",
    "--remap-path-prefix=\\?\$ProjectDir=/workspace",
    "--remap-path-prefix=$ProjectDirForward=/workspace",
    "--remap-path-prefix=$CargoHomeDir=/cargo",
    "--remap-path-prefix=\\?\$CargoHomeDir=/cargo",
    "--remap-path-prefix=$CargoHomeDirForward=/cargo"
)
if ($env:GITHUB_WORKSPACE) {
    $CiWorkspaceRoot = Split-Path -Parent (Split-Path -Parent $env:GITHUB_WORKSPACE)
    $CiWorkspaceRootForward = $CiWorkspaceRoot.Replace('\', '/')
    $RemapFlags += @(
        "--remap-path-prefix=$CiWorkspaceRoot=/ci",
        "--remap-path-prefix=\\?\$CiWorkspaceRoot=/ci",
        "--remap-path-prefix=$CiWorkspaceRootForward=/ci"
    )
}
$PackageRustFlags = $RemapFlags -join $RustFlagSeparator

$RustVersion = & rustc -vV
if ($LASTEXITCODE -ne 0) {
    throw "rustc -vV failed with exit code $LASTEXITCODE."
}
$RustHostLine = $RustVersion | Where-Object { $_ -like "host: *" } | Select-Object -First 1
if (-not $RustHostLine) {
    throw "Cannot determine the Rust host target."
}
$RustHost = $RustHostLine.Substring(6).Trim()

switch ($RustHost) {
    "x86_64-pc-windows-msvc" {
        $PackageArch = "x64"
        $DriverPlatform = "win32_x64"
    }
    "aarch64-pc-windows-msvc" {
        $PackageArch = "arm64"
        $DriverPlatform = "win32_arm64"
    }
    default {
        throw "Unsupported Windows Rust host: $RustHost"
    }
}

$BuildTargetDir = Join-Path $ProjectDir "target\package-windows-$PackageArch"
$OutputDir = Join-Path $ProjectDir "dist\GamerCatch-Windows-$PackageArch"
$OutputZip = Join-Path $ProjectDir "dist\GamerCatch-Windows-$PackageArch.zip"

if ((Test-Path -LiteralPath $OutputDir) -or (Test-Path -LiteralPath $OutputZip)) {
    throw "Output already exists; move or remove it first: $OutputDir or $OutputZip"
}

$HasArtifactSigning = $env:WINDOWS_ARTIFACT_SIGNING_DLIB -and $env:WINDOWS_ARTIFACT_SIGNING_METADATA
$HasCertificateSigning = [bool]$env:WINDOWS_SIGN_CERT_SHA1
if (($env:WINDOWS_ARTIFACT_SIGNING_DLIB -or $env:WINDOWS_ARTIFACT_SIGNING_METADATA) -and -not $HasArtifactSigning) {
    throw "WINDOWS_ARTIFACT_SIGNING_DLIB and WINDOWS_ARTIFACT_SIGNING_METADATA must be configured together."
}
if (-not $HasArtifactSigning -and -not $HasCertificateSigning -and $env:ALLOW_UNSIGNED_WINDOWS -ne "1") {
    throw "No Windows signing identity configured. Set ALLOW_UNSIGNED_WINDOWS=1 only for an explicitly unsigned preview release."
}

$EnvironmentNames = @(
    "PLAYWRIGHT_DRIVER_CACHE_DIR",
    "PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD",
    "PLAYWRIGHT_NODE_EXE",
    "PLAYWRIGHT_CLI_JS",
    "CARGO_TARGET_DIR",
    "CARGO_ENCODED_RUSTFLAGS",
    "RUSTFLAGS"
)
$OriginalEnvironment = @{}
foreach ($Name in $EnvironmentNames) {
    $Item = Get-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
    if ($null -eq $Item) {
        $OriginalEnvironment[$Name] = $null
    }
    else {
        $OriginalEnvironment[$Name] = $Item.Value
    }
}

Push-Location $ProjectDir
try {
    $env:PLAYWRIGHT_DRIVER_CACHE_DIR = $DriverCache
    $env:CARGO_TARGET_DIR = $BuildTargetDir
    $env:CARGO_ENCODED_RUSTFLAGS = $PackageRustFlags
    Remove-Item -LiteralPath "Env:PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:PLAYWRIGHT_NODE_EXE" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:PLAYWRIGHT_CLI_JS" -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "Env:RUSTFLAGS" -ErrorAction SilentlyContinue

    & cargo build --release --locked --target $RustHost
    if ($LASTEXITCODE -ne 0) {
        throw "The driver assembly build failed with exit code $LASTEXITCODE."
    }

    $DriverDir = Join-Path $DriverCache "playwright-1.60.0-$DriverPlatform"
    $DriverNode = Join-Path $DriverDir "node.exe"
    $DriverCli = Join-Path $DriverDir "package\cli.js"
    if (-not (Test-Path -LiteralPath $DriverNode -PathType Leaf) -or
        -not (Test-Path -LiteralPath $DriverCli -PathType Leaf)) {
        throw "The Playwright 1.60.0 driver is incomplete: $DriverDir"
    }

    # Re-link without a compile-time absolute path into this build tree. The
    # launcher selects the driver copied beside the executable at runtime.
    $env:PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD = "1"
    & cargo build --release --locked --target $RustHost
    if ($LASTEXITCODE -ne 0) {
        throw "The distributable build failed with exit code $LASTEXITCODE."
    }
}
finally {
    foreach ($Name in $EnvironmentNames) {
        if ($null -eq $OriginalEnvironment[$Name]) {
            Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -LiteralPath "Env:$Name" -Value $OriginalEnvironment[$Name]
        }
    }
    Pop-Location
}

$BinaryPath = Join-Path $BuildTargetDir "$RustHost\release\gamer-catch-rust.exe"
if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "Release executable not found: $BinaryPath"
}

$BinaryBytes = [System.IO.File]::ReadAllBytes($BinaryPath)
$BinaryText = [System.Text.Encoding]::UTF8.GetString($BinaryBytes)
if ($BinaryText.Contains($DriverCache, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The release executable still contains the local Playwright driver cache path."
}

$LocalPathPattern = '(?i)(?:/Users/[^/\x00]+/|/home/runner/work/|[A-Z]:\\Users\\[^\\\x00]+\\|[A-Z]:\\a\\)[^\x00-\x1f]{0,240}'
$LocalPathMatch = [regex]::Match($BinaryText, $LocalPathPattern)
if ($LocalPathMatch.Success) {
    $LocalPathDetail = $LocalPathMatch.Value -replace '[^\u0020-\u007e]', '?'
    throw "The release executable still contains a local user or CI workspace absolute path: $LocalPathDetail"
}

New-Item -ItemType Directory -Path $OutputDir | Out-Null
$PackagedExe = Join-Path $OutputDir "GamerCatch.exe"
Copy-Item -LiteralPath $BinaryPath -Destination $PackagedExe
Copy-Item -LiteralPath (Join-Path $ProjectDir "config.example.toml") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "config.example.toml") -Destination (Join-Path $OutputDir "config.toml")
Copy-Item -LiteralPath (Join-Path $ProjectDir "README.md") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "LICENSE") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "THIRD_PARTY_NOTICES.md") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "使用說明.txt") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "scripts\1_首次設定.cmd") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "scripts\2_開始抓取.cmd") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "scripts\Gmail_首次授權.cmd") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "scripts\3_安裝每天早上9點自動抓取.cmd") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $ProjectDir "scripts\install-windows-task.ps1") -Destination $OutputDir
New-Item -ItemType Directory -Path (Join-Path $OutputDir "credentials") | Out-Null
$BundledDriver = Join-Path $OutputDir "playwright-driver"
Copy-Item -LiteralPath $DriverDir -Destination $BundledDriver -Recurse

if (-not (Test-Path -LiteralPath (Join-Path $BundledDriver "node.exe") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $BundledDriver "package\cli.js") -PathType Leaf)) {
    throw "Packaged Playwright driver validation failed."
}

$ArtifactDlib = $env:WINDOWS_ARTIFACT_SIGNING_DLIB
$ArtifactMetadata = $env:WINDOWS_ARTIFACT_SIGNING_METADATA
$CertificateSha1 = $env:WINDOWS_SIGN_CERT_SHA1
$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL
if ($ArtifactDlib -and $ArtifactMetadata) {
    & signtool.exe sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 `
        /dlib $ArtifactDlib /dmdf $ArtifactMetadata $PackagedExe
    if ($LASTEXITCODE -ne 0) {
        throw "Artifact Signing failed with exit code $LASTEXITCODE."
    }
}
elseif ($CertificateSha1) {
    if (-not $TimestampUrl) {
        throw "WINDOWS_SIGN_CERT_SHA1 also requires WINDOWS_TIMESTAMP_URL."
    }
    & signtool.exe sign /v /fd SHA256 /sha1 $CertificateSha1 /tr $TimestampUrl /td SHA256 $PackagedExe
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode signing failed with exit code $LASTEXITCODE."
    }
}
else {
    Write-Information `
        "Preview status: unsigned Windows package explicitly enabled by ALLOW_UNSIGNED_WINDOWS=1." `
        -InformationAction Continue
}

if ($ArtifactDlib -and $ArtifactMetadata -or $CertificateSha1) {
    & signtool.exe verify /pa /v $PackagedExe
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode verification failed with exit code $LASTEXITCODE."
    }
}

& python (Join-Path $ProjectDir "scripts\create-release-zip.py") $OutputDir $OutputZip
if ($LASTEXITCODE -ne 0) {
    throw "Windows ZIP creation failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $OutputZip -PathType Leaf)) {
    throw "Windows ZIP creation failed: $OutputZip"
}

Write-Host "Windows package created: $OutputZip"
Write-Host "After setup and a successful test run, use the third CMD file to install the optional daily task."
