@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "CONFIG=%BASE%config.toml"
set "CREDENTIALS=%BASE%credentials"
set "APP=%BASE%GamerCatch.exe"
set "DRIVER=%BASE%playwright-driver"
set "MANUAL=%BASE%GamerCatch_零基礎使用手冊_Windows.pdf"

pushd "%BASE%" >nul
if not exist "%CREDENTIALS%" mkdir "%CREDENTIALS%"
if not exist "%CONFIG%" copy /Y "%BASE%config.example.toml" "%CONFIG%" >nul
if not exist "%APP%" goto :incomplete
if not exist "%DRIVER%\node.exe" goto :incomplete
if not exist "%DRIVER%\package\cli.js" goto :incomplete

set "PLAYWRIGHT_DRIVER_PATH=%DRIVER%"
echo 正在準備 Chromium。第一次可能需要數分鐘，請勿關閉視窗...
"%APP%" --install-browser
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :install_failed

start "" notepad.exe "%CONFIG%"
start "" explorer.exe "%CREDENTIALS%"
if exist "%MANUAL%" start "" "%MANUAL%"
echo.
echo 設定檔、credentials 資料夾與零基礎手冊已開啟。
echo 填寫並儲存後，請雙擊「2_開始抓取.cmd」。
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。
goto :done

:install_failed
echo Chromium 安裝失敗，請確認網路連線後重試。

:done
echo.
echo 按任意鍵關閉視窗...
pause >nul
popd >nul
exit /b %RC%
