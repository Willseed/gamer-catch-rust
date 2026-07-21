$ErrorActionPreference = "Stop"

$OriginalDriverPath = Get-Item -LiteralPath "Env:PLAYWRIGHT_DRIVER_PATH" -ErrorAction SilentlyContinue
$ExitCode = 1
try {
    $env:PLAYWRIGHT_DRIVER_PATH = Join-Path $PSScriptRoot "playwright-driver"
    & (Join-Path $PSScriptRoot "gamer-catch-rust.exe") @args
    $ExitCode = $LASTEXITCODE
}
finally {
    if ($null -eq $OriginalDriverPath) {
        Remove-Item -LiteralPath "Env:PLAYWRIGHT_DRIVER_PATH" -ErrorAction SilentlyContinue
    }
    else {
        $env:PLAYWRIGHT_DRIVER_PATH = $OriginalDriverPath.Value
    }
}

if ($ExitCode -ne 0) {
    throw "gamer-catch-rust failed with exit code $ExitCode."
}
