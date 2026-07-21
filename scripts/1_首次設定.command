#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CONFIG_PATH="$SCRIPT_DIR/config.toml"
CREDENTIALS_DIR="$SCRIPT_DIR/credentials"
BINARY_PATH="$SCRIPT_DIR/GamerCatch"
DRIVER_PATH="$SCRIPT_DIR/playwright-driver"
GUIDE_URL="https://gamer.catch.pylot.dev/guide#quick-start"

cd "$SCRIPT_DIR" || exit 1
mkdir -p "$CREDENTIALS_DIR"
if [[ ! -f "$CONFIG_PATH" ]]; then
  cp "$SCRIPT_DIR/config.example.toml" "$CONFIG_PATH"
fi

if [[ ! -x "$BINARY_PATH" || ! -x "$DRIVER_PATH/node" || ! -f "$DRIVER_PATH/package/cli.js" ]]; then
  echo "發行檔不完整，請重新解壓縮整個資料夾後再試。"
  printf '\n按 Return 關閉視窗…'
  IFS= read -r _ || true
  exit 1
fi

export PLAYWRIGHT_DRIVER_PATH="$DRIVER_PATH"
echo "正在準備 Chromium。第一次可能需要數分鐘，請勿關閉視窗…"
if ! "$BINARY_PATH" --install-browser; then
  echo "Chromium 安裝失敗，請確認網路連線後重試。"
  printf '\n按 Return 關閉視窗…'
  IFS= read -r _ || true
  exit 1
fi

open -a TextEdit "$CONFIG_PATH"
open "$CREDENTIALS_DIR"
open "$GUIDE_URL"
echo
echo "設定檔、credentials 資料夾與線上教學已開啟。"
echo "填寫並儲存後，請雙擊「2_開始抓取.command」。"
echo "要啟用異常信件時，再依線上教學填寫 Gmail 設定並雙擊「Gmail_首次授權.command」。"
printf '\n按 Return 關閉視窗…'
IFS= read -r _ || true
