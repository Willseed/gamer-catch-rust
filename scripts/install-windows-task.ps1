[CmdletBinding()]
param(
    [switch]$ScheduledRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$TaskNamePrefix = "GamerCatch-Daily-0900"
$TaskPath = "\"
$ExecutablePath = Join-Path $PSScriptRoot "GamerCatch.exe"
$ConfigPath = Join-Path $PSScriptRoot "config.toml"
$DriverPath = Join-Path $PSScriptRoot "playwright-driver"
$DriverNodePath = Join-Path $DriverPath "node.exe"
$DriverCliPath = Join-Path $DriverPath "package\cli.js"
$CredentialsPath = Join-Path $PSScriptRoot "credentials"
$LogPath = Join-Path $PSScriptRoot "last-scheduled-run.log"

function Assert-ReleasePackage {
    $RequiredFiles = @(
        $ExecutablePath,
        $ConfigPath,
        $DriverNodePath,
        $DriverCliPath
    )
    foreach ($RequiredFile in $RequiredFiles) {
        if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) {
            throw "The release package is incomplete or was not fully extracted: $RequiredFile"
        }
    }
    if (-not (Test-Path -LiteralPath $CredentialsPath -PathType Container)) {
        throw "The release package is missing the credentials directory: $CredentialsPath"
    }
}

function Get-CurrentIdentity {
    $Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($null -eq $Identity -or $null -eq $Identity.User -or [string]::IsNullOrWhiteSpace($Identity.Name)) {
        throw "Cannot determine the current Windows user."
    }
    return $Identity
}

function Get-GamerCatchTaskName {
    $Identity = Get-CurrentIdentity
    return "$TaskNamePrefix-$($Identity.User.Value)"
}

function Get-NextDailyRun {
    $Now = Get-Date
    $NextRun = $Now.Date.AddHours(9)
    if ($NextRun -le $Now) {
        $NextRun = $NextRun.AddDays(1)
    }
    return $NextRun
}

function Write-ScheduledLog {
    param(
        [string]$StartedAt,
        [string]$CompletedAt,
        [int]$ExitCode,
        [string]$StandardOutput,
        [string]$StandardError
    )

    $Builder = New-Object System.Text.StringBuilder
    [void]$Builder.AppendLine("GamerCatch scheduled run")
    [void]$Builder.AppendLine("Started: $StartedAt")
    [void]$Builder.AppendLine("Completed: $CompletedAt")
    [void]$Builder.AppendLine("Exit code: $ExitCode")
    [void]$Builder.AppendLine()
    if (-not [string]::IsNullOrEmpty($StandardOutput)) {
        [void]$Builder.AppendLine($StandardOutput.TrimEnd())
    }
    if (-not [string]::IsNullOrEmpty($StandardError)) {
        [void]$Builder.AppendLine($StandardError.TrimEnd())
    }

    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($LogPath, $Builder.ToString(), $Utf8NoBom)
}

function Write-ScheduledFailureLog {
    param([string]$Message)

    try {
        $Timestamp = (Get-Date).ToString("o")
        Write-ScheduledLog `
            -StartedAt $Timestamp `
            -CompletedAt $Timestamp `
            -ExitCode 1 `
            -StandardOutput "" `
            -StandardError $Message
    }
    catch {
        # Task Scheduler will still retain the nonzero process exit code.
    }
}

function Invoke-GamerCatchScheduledRun {
    Assert-ReleasePackage

    $StartedAt = (Get-Date).ToString("o")
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $ExecutablePath
    $StartInfo.Arguments = '--config "{0}"' -f $ConfigPath
    $StartInfo.WorkingDirectory = $PSScriptRoot
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.StandardOutputEncoding = $Utf8NoBom
    $StartInfo.StandardErrorEncoding = $Utf8NoBom
    $StartInfo.EnvironmentVariables["PLAYWRIGHT_DRIVER_PATH"] = $DriverPath

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    try {
        if (-not $Process.Start()) {
            throw "GamerCatch.exe did not start."
        }
        $StandardOutputTask = $Process.StandardOutput.ReadToEndAsync()
        $StandardErrorTask = $Process.StandardError.ReadToEndAsync()
        $Process.WaitForExit()
        $StandardOutput = $StandardOutputTask.Result
        $StandardError = $StandardErrorTask.Result
        $ExitCode = $Process.ExitCode
    }
    finally {
        $Process.Dispose()
    }

    $CompletedAt = (Get-Date).ToString("o")
    Write-ScheduledLog `
        -StartedAt $StartedAt `
        -CompletedAt $CompletedAt `
        -ExitCode $ExitCode `
        -StandardOutput $StandardOutput `
        -StandardError $StandardError
    return $ExitCode
}

function Install-GamerCatchScheduledTask {
    Assert-ReleasePackage
    Import-Module ScheduledTasks -ErrorAction Stop

    $Identity = Get-CurrentIdentity
    $TaskName = Get-GamerCatchTaskName
    $PowerShellPath = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path -LiteralPath $PowerShellPath -PathType Leaf)) {
        throw "Windows PowerShell 5.1 was not found: $PowerShellPath"
    }

    $ScriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
    $ActionArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ScheduledRun' -f $ScriptPath
    $Action = New-ScheduledTaskAction `
        -Execute $PowerShellPath `
        -Argument $ActionArguments `
        -WorkingDirectory $PSScriptRoot
    $Trigger = New-ScheduledTaskTrigger -Daily -At (Get-NextDailyRun)
    $Principal = New-ScheduledTaskPrincipal `
        -UserId $Identity.Name `
        -LogonType Interactive `
        -RunLevel Limited
    $Settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -WakeToRun `
        -RunOnlyIfNetworkAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1)

    $null = Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $TaskPath `
        -Action $Action `
        -Trigger $Trigger `
        -Principal $Principal `
        -Settings $Settings `
        -Description "GamerCatch daily ranking capture at 09:00 for the current user." `
        -Force

    $RegisteredTask = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    $TaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath
    if ([string]$RegisteredTask.Principal.RunLevel -ne "Limited" -or
        [string]$RegisteredTask.Principal.LogonType -ne "Interactive") {
        throw "The scheduled task was not registered with limited interactive permissions."
    }

    Write-Host "Scheduled task installed or updated."
    Write-Host "Task name: $TaskName"
    Write-Host "Next run: $($TaskInfo.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Host "No administrator privileges or stored Windows password are used."
}

if ($ScheduledRun) {
    try {
        exit (Invoke-GamerCatchScheduledRun)
    }
    catch {
        $FailureMessage = $_.Exception.ToString()
        Write-ScheduledFailureLog -Message $FailureMessage
        exit 1
    }
}

try {
    Install-GamerCatchScheduledTask
}
catch {
    [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
    exit 1
}
