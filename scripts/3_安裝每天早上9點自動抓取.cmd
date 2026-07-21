@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "INSTALLER=%BASE%install-windows-task.ps1"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

pushd "%BASE%" >nul
if not exist "%INSTALLER%" goto :incomplete
if not exist "%POWERSHELL%" goto :missing_powershell

echo 正在安裝每天早上 9 點自動抓取的 Windows 工作排程...
"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%INSTALLER%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
    echo 安裝成功。不需要系統管理員權限，也不會儲存 Windows 密碼。
    echo 重新雙擊本檔案會更新原本的排程，不會建立重複工作。
) else (
    echo 安裝失敗。請查看上方訊息；公司電腦若有政策限制，請聯絡 IT 管理員。
)
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。
goto :done

:missing_powershell
set "RC=1"
echo 找不到 Windows PowerShell 5.1，無法安裝工作排程。

:done
echo.
echo 按任意鍵關閉視窗...
pause >nul
popd >nul
exit /b %RC%
