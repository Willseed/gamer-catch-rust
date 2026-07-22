@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "CREDENTIALS=%BASE%credentials"
set "APP=%BASE%GamerCatch.exe"
set "DRIVER=%BASE%playwright-driver"
set "GUIDE_URL=https://gamer-catch.pylot.dev/guide#quick-start"
set "NO_OPEN=0"
set "NO_PAUSE=0"
if /I "%~1"=="--no-open" set "NO_OPEN=1"
if /I "%~2"=="--no-open" set "NO_OPEN=1"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
if /I "%~2"=="--no-pause" set "NO_PAUSE=1"

pushd "%BASE%" >nul
set "RC=0"
if not exist "%CREDENTIALS%" mkdir "%CREDENTIALS%"
if not exist "%APP%" goto :incomplete
if not exist "%DRIVER%\node.exe" goto :incomplete
if not exist "%DRIVER%\package\cli.js" goto :incomplete

set "PLAYWRIGHT_DRIVER_PATH=%DRIVER%"
echo 正在準備 Chromium。第一次可能需要數分鐘，請勿關閉視窗...
"%APP%" --install-browser
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :install_failed

if "%NO_OPEN%"=="1" goto :skip_open
start "" explorer.exe "%CREDENTIALS%"
start "" "%GUIDE_URL%"

:skip_open
echo.
echo credentials 資料夾與線上教學已開啟。
echo 請依教學使用設定檔產生器下載 config.toml，放到本資料夾最外層。
echo 放好設定檔後，請雙擊「2_開始抓取.cmd」。
echo 要啟用異常信件時，再依線上教學填寫 Gmail 設定並雙擊「Gmail_首次授權.cmd」。
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。
goto :done

:install_failed
echo Chromium 安裝失敗，請確認網路連線後重試。

:done
echo.
if "%NO_PAUSE%"=="1" goto :finish
echo 按任意鍵關閉視窗...
pause >nul

:finish
popd >nul
exit /b %RC%
