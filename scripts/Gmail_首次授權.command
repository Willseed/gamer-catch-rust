#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CONFIG_PATH="$SCRIPT_DIR/config.toml"
BINARY_PATH="$SCRIPT_DIR/GamerCatch"
LOG_PATH="$SCRIPT_DIR/last-gmail-authorization.log"
GENERATOR_URL="https://gamer-catch.pylot.dev/generator"

pause_and_exit() {
  local exit_code="$1"
  printf '\n按 Return 關閉視窗…'
  IFS= read -r _ || true
  exit "$exit_code"
}

cd "$SCRIPT_DIR" || exit 1
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "找不到 config.toml；本腳本不會自動建立或覆蓋設定檔。"
  echo "請前往設定檔產生器完成 Gmail 設定並下載 config.toml，放到 GamerCatch 資料夾最外層："
  echo "$GENERATOR_URL"
  echo "放好設定檔後，請再雙擊本檔。"
  pause_and_exit 1
fi
if [[ ! -x "$BINARY_PATH" ]]; then
  echo "發行檔不完整。請先完整解壓縮，不要直接在 ZIP 內執行。"
  pause_and_exit 1
fi

echo "開始 Gmail 首次授權；瀏覽器開啟後，請登入設定的寄件帳號…"
"$BINARY_PATH" --config "$CONFIG_PATH" --authorize-gmail 2>&1 | tee "$LOG_PATH"
APP_EXIT=${PIPESTATUS[0]}

echo
if [[ "$APP_EXIT" -eq 0 ]]; then
  echo "Gmail 授權與測試信完成。"
else
  echo "Gmail 授權或測試信未完成，請查看上方訊息或 last-gmail-authorization.log。"
fi
pause_and_exit "$APP_EXIT"
