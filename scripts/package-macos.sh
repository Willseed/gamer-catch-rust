#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIVER_CACHE="$PROJECT_DIR/target/playwright-driver-cache"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
RUSTFLAG_SEPARATOR=$'\x1f'
PACKAGE_RUSTFLAGS="--remap-path-prefix=$PROJECT_DIR=/workspace${RUSTFLAG_SEPARATOR}--remap-path-prefix=$CARGO_HOME_DIR=/cargo"

RUST_HOST="$(rustc -vV | sed -n 's/^host: //p')"
case "$RUST_HOST" in
  aarch64-apple-darwin)
    PACKAGE_ARCH="arm64"
    DRIVER_PLATFORM="mac-arm64"
    ;;
  x86_64-apple-darwin)
    PACKAGE_ARCH="x64"
    DRIVER_PLATFORM="mac"
    ;;
  *)
    echo "不支援的 macOS Rust host：$RUST_HOST" >&2
    exit 1
    ;;
esac

BUILD_TARGET_DIR="$PROJECT_DIR/target/package-macos-$PACKAGE_ARCH"
OUTPUT_DIR="$PROJECT_DIR/dist/GamerCatch-macOS-$PACKAGE_ARCH"
OUTPUT_ZIP="$PROJECT_DIR/dist/GamerCatch-macOS-$PACKAGE_ARCH.zip"
MANUAL_PATH="$PROJECT_DIR/output/pdf/GamerCatch_零基礎使用手冊_macOS.pdf"
if [[ -e "$OUTPUT_DIR" || -e "$OUTPUT_ZIP" ]]; then
  echo "輸出已存在，請先移走：$OUTPUT_DIR 或 $OUTPUT_ZIP" >&2
  exit 1
fi
if [[ ! -f "$MANUAL_PATH" ]]; then
  echo "找不到 macOS PDF 手冊：$MANUAL_PATH" >&2
  echo "請先執行 scripts/generate-manual.py。" >&2
  exit 1
fi

SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:-}"
if [[ -z "$SIGN_IDENTITY" ]]; then
  IDENTITY_LINES="$(security find-identity -v -p codesigning 2>/dev/null | grep 'Developer ID Application' || true)"
  IDENTITY_COUNT="$(printf '%s\n' "$IDENTITY_LINES" | grep -c 'Developer ID Application' || true)"
  if [[ "$IDENTITY_COUNT" -eq 1 ]]; then
    SIGN_IDENTITY="$(printf '%s\n' "$IDENTITY_LINES" | awk '{print $2}')"
  elif [[ "$IDENTITY_COUNT" -gt 1 ]]; then
    echo "找到多個 Developer ID Application；請設定 MACOS_SIGN_IDENTITY 指定一個。" >&2
    exit 1
  fi
fi

NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-}"
ALLOW_UNSIGNED="${ALLOW_UNSIGNED_MACOS:-0}"
ALLOW_UNNOTARIZED="${ALLOW_UNNOTARIZED_MACOS:-0}"
if [[ -n "$NOTARY_PROFILE" && -z "$SIGN_IDENTITY" ]]; then
  echo "設定 MACOS_NOTARY_PROFILE 時也必須有 Developer ID Application。" >&2
  exit 1
fi
if [[ -z "$SIGN_IDENTITY" && "$ALLOW_UNSIGNED" != "1" ]]; then
  echo "未找到 Developer ID Application；拒絕產生可能被誤發佈的未簽章版本。" >&2
  echo "僅限明確接受風險的測試／預覽發佈，才設定 ALLOW_UNSIGNED_MACOS=1。" >&2
  exit 1
fi
if [[ -n "$SIGN_IDENTITY" && -z "$NOTARY_PROFILE" && "$ALLOW_UNNOTARIZED" != "1" ]]; then
  echo "找到 Developer ID，但未設定 MACOS_NOTARY_PROFILE；拒絕產生可能被誤發佈的未公證版本。" >&2
  echo "請設定公證 profile；僅限預覽版才設定 ALLOW_UNNOTARIZED_MACOS=1。" >&2
  exit 1
fi

cd "$PROJECT_DIR"
env -u PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD \
  -u PLAYWRIGHT_NODE_EXE \
  -u PLAYWRIGHT_CLI_JS \
  -u RUSTFLAGS \
  PLAYWRIGHT_DRIVER_CACHE_DIR="$DRIVER_CACHE" \
  CARGO_ENCODED_RUSTFLAGS="$PACKAGE_RUSTFLAGS" \
  CARGO_TARGET_DIR="$BUILD_TARGET_DIR" \
  cargo build --release --locked --target "$RUST_HOST"

DRIVER_DIR="$DRIVER_CACHE/playwright-1.60.0-$DRIVER_PLATFORM"
if [[ ! -x "$DRIVER_DIR/node" || ! -f "$DRIVER_DIR/package/cli.js" ]]; then
  echo "Playwright 1.60.0 driver 不完整：$DRIVER_DIR" >&2
  exit 1
fi

# 重新連結成不含本機 target 絕對路徑的可攜成品。
env -u PLAYWRIGHT_NODE_EXE \
  -u PLAYWRIGHT_CLI_JS \
  -u RUSTFLAGS \
  PLAYWRIGHT_DRIVER_CACHE_DIR="$DRIVER_CACHE" \
  PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 \
  CARGO_ENCODED_RUSTFLAGS="$PACKAGE_RUSTFLAGS" \
  CARGO_TARGET_DIR="$BUILD_TARGET_DIR" \
  cargo build --release --locked --target "$RUST_HOST"

BINARY_PATH="$BUILD_TARGET_DIR/$RUST_HOST/release/gamer-catch-rust"
if [[ ! -x "$BINARY_PATH" ]]; then
  echo "找不到 release 執行檔：$BINARY_PATH" >&2
  exit 1
fi
if LC_ALL=C grep -aF "$DRIVER_CACHE" "$BINARY_PATH" >/dev/null; then
  echo "release 執行檔仍包含本機 Playwright driver cache 路徑。" >&2
  exit 1
fi
if LC_ALL=C grep -aE '/Users/[^/]+/|/home/runner/work/' "$BINARY_PATH" >/dev/null; then
  echo "release 執行檔仍包含本機使用者或 CI workspace 絕對路徑。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR/credentials"
cp "$BINARY_PATH" "$OUTPUT_DIR/GamerCatch"
cp "$PROJECT_DIR/config.example.toml" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/config.example.toml" "$OUTPUT_DIR/config.toml"
cp "$PROJECT_DIR/README.md" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/LICENSE" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/使用說明.txt" "$OUTPUT_DIR/"
cp "$MANUAL_PATH" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/scripts/1_首次設定.command" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/scripts/2_開始抓取.command" "$OUTPUT_DIR/"
cp "$PROJECT_DIR/scripts/Gmail_首次授權.command" "$OUTPUT_DIR/"
cp -R "$DRIVER_DIR" "$OUTPUT_DIR/playwright-driver"
chmod +x \
  "$OUTPUT_DIR/GamerCatch" \
  "$OUTPUT_DIR/1_首次設定.command" \
  "$OUTPUT_DIR/2_開始抓取.command" \
  "$OUTPUT_DIR/Gmail_首次授權.command" \
  "$OUTPUT_DIR/playwright-driver/node"

if [[ ! -x "$OUTPUT_DIR/playwright-driver/node" || ! -f "$OUTPUT_DIR/playwright-driver/package/cli.js" ]]; then
  echo "封裝後的 Playwright driver 驗證失敗。" >&2
  exit 1
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "以 Developer ID 簽署 Rust 主程式與 Node：$SIGN_IDENTITY"
  codesign --force --options runtime --timestamp \
    --entitlements "$PROJECT_DIR/packaging/macos/Node.entitlements" \
    --sign "$SIGN_IDENTITY" \
    "$OUTPUT_DIR/playwright-driver/node"
  codesign --force --options runtime --timestamp \
    --sign "$SIGN_IDENTITY" \
    "$OUTPUT_DIR/GamerCatch"
  codesign --verify --strict --verbose=2 "$OUTPUT_DIR/playwright-driver/node"
  codesign --verify --strict --verbose=2 "$OUTPUT_DIR/GamerCatch"
else
  echo "警告：已明確允許建立未簽章 macOS 預覽版。"
fi

python3 "$PROJECT_DIR/scripts/create-release-zip.py" "$OUTPUT_DIR" "$OUTPUT_ZIP"

if [[ -n "$NOTARY_PROFILE" ]]; then
  echo "送交 Apple notarization：$OUTPUT_ZIP"
  xcrun notarytool submit "$OUTPUT_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
elif [[ -n "$SIGN_IDENTITY" ]]; then
  echo "警告：已明確允許建立未公證 macOS 預覽版。"
fi

echo "macOS 腳本發行包完成：$OUTPUT_ZIP"
