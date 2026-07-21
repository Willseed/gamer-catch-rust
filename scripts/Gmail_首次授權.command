#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CONFIG_PATH="$SCRIPT_DIR/config.toml"
BINARY_PATH="$SCRIPT_DIR/GamerCatch"
LOG_PATH="$SCRIPT_DIR/last-gmail-authorization.log"

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
  echo "尚未設定。請先填完 [gmail_notifications]，再雙擊本檔。"
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
