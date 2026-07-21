@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "BASE=%~dp0"
set "CONFIG=%BASE%config.toml"
set "APP=%BASE%GamerCatch.exe"
set "DRIVER=%BASE%playwright-driver"
set "LOG=%BASE%last-run.log"

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
if "%RC%"=="0" (
    echo 全部處理完成。
) else (
    echo 有項目未完成，請查看上方錯誤訊息或 last-run.log。
)
goto :done

:missing_config
copy /Y "%BASE%config.example.toml" "%CONFIG%" >nul
start "" notepad.exe "%CONFIG%"
set "RC=1"
echo 尚未設定。填完並儲存後，請再雙擊本檔。
goto :done

:incomplete
set "RC=1"
echo 發行檔不完整。請先完整解壓縮整個資料夾，不要直接在 ZIP 內執行。
goto :done

:done
echo.
echo 按任意鍵關閉視窗...
pause >nul
popd >nul
exit /b %RC%
