@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "CONFIG=%BASE%config.toml"
set "APP=%BASE%GamerCatch.exe"
set "DRIVER=%BASE%playwright-driver"
set "LOG=%BASE%last-run.log"
set "GENERATOR_URL=https://gamer-catch.pylot.dev/generator"

pushd "%BASE%" >nul
if not exist "%CONFIG%" goto :missing_config
if not exist "%APP%" goto :incomplete
if not exist "%DRIVER%\node.exe" goto :incomplete
if not exist "%DRIVER%\package\cli.js" goto :incomplete

set "PLAYWRIGHT_DRIVER_PATH=%DRIVER%"
echo 開始抓取所有已啟用的遊戲；首次執行可能需要數分鐘下載 Chromium...
"%APP%" --config "%CONFIG%" > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%LOG%"
echo.
if not "%RC%"=="0" goto :run_failed

echo 全部處理完成。
goto :done

:run_failed
echo 有項目未完成，請查看上方錯誤訊息或 last-run.log。
goto :done

:missing_config
set "RC=1"
echo 找不到 config.toml；本腳本不會自動建立或覆蓋設定檔。
echo 請前往設定檔產生器下載 config.toml，放到 GamerCatch 資料夾最外層：
echo %GENERATOR_URL%
echo 放好設定檔後，請再雙擊本檔。
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。
goto :done

:done
echo.
if /I "%~1"=="--no-pause" goto :finish
echo 按任意鍵關閉視窗...
pause >nul

:finish
popd >nul
exit /b %RC%
