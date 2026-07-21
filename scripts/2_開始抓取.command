#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CONFIG_PATH="$SCRIPT_DIR/config.toml"
BINARY_PATH="$SCRIPT_DIR/GamerCatch"
DRIVER_PATH="$SCRIPT_DIR/playwright-driver"
LOG_PATH="$SCRIPT_DIR/last-run.log"

pause_and_exit() {
  local exit_code="$1"
  printf '\n按 Return 關閉視窗…'
  IFS= read -r _ || true
  exit "$exit_code"
}

cd "$SCRIPT_DIR" || exit 1
if [[ ! -f "$CONFIG_PATH" ]]; then
  cp "$SCRIPT_DIR/config.example.toml" "$CONFIG_PATH"
  open -a TextEdit "$CONFIG_PATH"
  echo "尚未設定。填完並儲存後，請再雙擊本檔。"
  pause_and_exit 1
fi
if [[ ! -x "$BINARY_PATH" || ! -x "$DRIVER_PATH/node" || ! -f "$DRIVER_PATH/package/cli.js" ]]; then
  echo "發行檔不完整，請先完整解壓縮，不要直接在壓縮檔內執行。"
  pause_and_exit 1
fi

export PLAYWRIGHT_DRIVER_PATH="$DRIVER_PATH"
echo "開始抓取所有已啟用的遊戲；首次執行可能需要數分鐘下載 Chromium…"
"$BINARY_PATH" --config "$CONFIG_PATH" 2>&1 | tee "$LOG_PATH"
APP_EXIT=${PIPESTATUS[0]}

echo
if [[ "$APP_EXIT" -eq 0 ]]; then
  echo "全部處理完成。"
else
  echo "有項目未完成，請查看上方訊息或 last-run.log。"
fi
pause_and_exit "$APP_EXIT"
