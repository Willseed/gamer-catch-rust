@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "CONFIG=%BASE%config.toml"
set "APP=%BASE%GamerCatch.exe"
set "LOG=%BASE%last-gmail-authorization.log"

pushd "%BASE%" >nul
if not exist "%CONFIG%" goto :missing_config
if not exist "%APP%" goto :incomplete

echo 開始 Gmail 首次授權；瀏覽器開啟後，請登入設定的寄件帳號...
"%APP%" --config "%CONFIG%" --authorize-gmail > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%LOG%"
echo.
if not "%RC%"=="0" goto :authorization_failed

echo Gmail 授權與測試信完成。
goto :done

:authorization_failed
echo Gmail 授權或測試信未完成，請查看上方訊息或 last-gmail-authorization.log。
goto :done

:missing_config
copy /Y "%BASE%config.example.toml" "%CONFIG%" >nul
start "" notepad.exe "%CONFIG%"
set "RC=1"
echo 尚未設定。請先填完 [gmail_notifications]，再雙擊本檔。
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。

:done
echo.
if /I "%~1"=="--no-pause" goto :finish
echo 按任意鍵關閉視窗...
pause >nul

:finish
popd >nul
exit /b %RC%
