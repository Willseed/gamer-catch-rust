#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIVER_CACHE="$PROJECT_DIR/target/playwright-driver-cache"
PACKAGER_TARGET_DIR="$PROJECT_DIR/target/release-packager"
PACKAGER_BIN="$PACKAGER_TARGET_DIR/release/gamercatch-release-packager"
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
PENDING_ZIP="$PROJECT_DIR/dist/.GamerCatch-macOS-$PACKAGE_ARCH.pending.zip"
PACKAGE_PHASE="${MACOS_PACKAGE_PHASE:-full}"
case "$PACKAGE_PHASE" in
  full | prepare | finalize) ;;
  *)
    echo "MACOS_PACKAGE_PHASE 必須是 full、prepare 或 finalize。" >&2
    exit 1
    ;;
esac
if [[ "$PACKAGE_PHASE" == "finalize" ]]; then
  if [[ ! -d "$OUTPUT_DIR" || -e "$OUTPUT_ZIP" || -e "$PENDING_ZIP" ]]; then
    echo "finalize 需要既有 staging 目錄且 ZIP 尚未建立：$OUTPUT_DIR" >&2
    exit 1
  fi
elif [[ -e "$OUTPUT_DIR" || -e "$OUTPUT_ZIP" || -e "$PENDING_ZIP" ]]; then
  echo "輸出已存在，請先移走：$OUTPUT_DIR、$OUTPUT_ZIP 或 $PENDING_ZIP" >&2
  exit 1
fi

cleanup_pending_zip() {
  rm -f -- "$PENDING_ZIP"
}
trap cleanup_pending_zip EXIT

SIGN_IDENTITY=""
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-}"
NOTARY_KEY_PATH="${MACOS_NOTARY_KEY_PATH:-}"
NOTARY_KEY_ID="${MACOS_NOTARY_KEY_ID:-}"
NOTARY_ISSUER_ID="${MACOS_NOTARY_ISSUER_ID:-}"
EXPECTED_TEAM_ID="${MACOS_EXPECTED_TEAM_ID:-}"
ALLOW_UNSIGNED="${ALLOW_UNSIGNED_MACOS:-0}"
ALLOW_UNNOTARIZED="${ALLOW_UNNOTARIZED_MACOS:-0}"
DIRECT_NOTARY_CONFIGURED=0
if [[ "$PACKAGE_PHASE" != "prepare" ]]; then
  if [[ -n "$EXPECTED_TEAM_ID" && ! "$EXPECTED_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "MACOS_EXPECTED_TEAM_ID 必須是 10 碼 Apple Developer Team ID。" >&2
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

  if [[ -n "$NOTARY_PROFILE" && ( -n "$NOTARY_KEY_PATH" || -n "$NOTARY_KEY_ID" || -n "$NOTARY_ISSUER_ID" ) ]]; then
    echo "MACOS_NOTARY_PROFILE 與 App Store Connect API key 設定只能擇一。" >&2
    exit 1
  fi
  if [[ -n "$NOTARY_KEY_PATH" || -n "$NOTARY_KEY_ID" || -n "$NOTARY_ISSUER_ID" ]]; then
    if [[ -z "$NOTARY_KEY_PATH" || -z "$NOTARY_KEY_ID" ]]; then
      echo "App Store Connect API key 公證至少需要 MACOS_NOTARY_KEY_PATH 與 MACOS_NOTARY_KEY_ID。" >&2
      exit 1
    fi
    if [[ ! -f "$NOTARY_KEY_PATH" ]]; then
      echo "找不到 App Store Connect API private key：$NOTARY_KEY_PATH" >&2
      exit 1
    fi
    DIRECT_NOTARY_CONFIGURED=1
  fi
  if [[ ( -n "$NOTARY_PROFILE" || "$DIRECT_NOTARY_CONFIGURED" -eq 1 ) && -z "$SIGN_IDENTITY" ]]; then
    echo "設定 Apple 公證憑證時也必須有 Developer ID Application。" >&2
    exit 1
  fi
  if [[ -z "$SIGN_IDENTITY" && "$ALLOW_UNSIGNED" != "1" ]]; then
    echo "未找到 Developer ID Application；拒絕產生可能被誤發佈的未簽章版本。" >&2
    echo "僅限明確接受風險的測試／預覽發佈，才設定 ALLOW_UNSIGNED_MACOS=1。" >&2
    exit 1
  fi
  if [[ -n "$SIGN_IDENTITY" && -z "$NOTARY_PROFILE" && "$DIRECT_NOTARY_CONFIGURED" -eq 0 && "$ALLOW_UNNOTARIZED" != "1" ]]; then
    echo "找到 Developer ID，但未設定 Apple 公證憑證；拒絕產生可能被誤發佈的未公證版本。" >&2
    echo "請設定公證 profile 或 App Store Connect API key；僅限預覽版才設定 ALLOW_UNNOTARIZED_MACOS=1。" >&2
    exit 1
  fi
fi

verify_developer_id_signature() {
  local path="$1"
  local signature_info
  local actual_team_id

  codesign --verify --strict --verbose=2 "$path"
  signature_info="$(codesign --display --verbose=4 "$path" 2>&1)"
  if ! grep -F 'Authority=Developer ID Application:' <<< "$signature_info" >/dev/null; then
    echo "簽章不是 Developer ID Application：$path" >&2
    exit 1
  fi
  if ! grep -E '^CodeDirectory .*flags=.*\(runtime\)' <<< "$signature_info" >/dev/null; then
    echo "簽章未啟用 hardened runtime：$path" >&2
    exit 1
  fi
  if ! grep -E '^Timestamp=' <<< "$signature_info" >/dev/null; then
    echo "簽章缺少 secure timestamp：$path" >&2
    exit 1
  fi
  actual_team_id="$(sed -n 's/^TeamIdentifier=//p' <<< "$signature_info")"
  if [[ -z "$actual_team_id" || "$actual_team_id" == "not set" ]]; then
    echo "簽章缺少 Developer Team identifier：$path" >&2
    exit 1
  fi
  if [[ -n "$EXPECTED_TEAM_ID" && "$actual_team_id" != "$EXPECTED_TEAM_ID" ]]; then
    echo "簽章 Team ID 不符預期：$path" >&2
    exit 1
  fi
}

submit_for_notarization() {
  local archive_path="$1"
  local -a notary_args=()
  local notary_result
  local notary_log
  local parsed_result
  local notary_status
  local issue_count
  local submission_id

  if [[ -n "$NOTARY_PROFILE" ]]; then
    notary_args=(--keychain-profile "$NOTARY_PROFILE")
  else
    notary_args=(--key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID")
    if [[ -n "$NOTARY_ISSUER_ID" ]]; then
      notary_args+=(--issuer "$NOTARY_ISSUER_ID")
    fi
  fi

  echo "送交 Apple notarization：$archive_path"
  if ! notary_result="$(
    xcrun notarytool submit \
      "${notary_args[@]}" \
      --wait \
      --timeout 30m \
      --output-format json \
      --no-progress \
      "$archive_path"
  )"; then
    echo "Apple notarization submit 命令失敗。" >&2
    printf '%s\n' "$notary_result" >&2
    exit 1
  fi
  if ! parsed_result="$(
    printf '%s' "$notary_result" | "$PACKAGER_BIN" notary-submission
  )"; then
    echo "無法解析 Apple notarization JSON 回覆。" >&2
    printf '%s\n' "$notary_result" >&2
    exit 1
  fi
  IFS=$'\t' read -r notary_status submission_id <<< "$parsed_result"
  if [[ -z "$notary_status" || -z "$submission_id" ]]; then
    echo "Apple notarization 回覆缺少有效的 status 或 submission ID。" >&2
    printf '%s\n' "$notary_result" >&2
    exit 1
  fi
  if ! notary_log="$(
    xcrun notarytool log "${notary_args[@]}" "$submission_id"
  )"; then
    echo "無法取得 Apple notarization log：$submission_id" >&2
    exit 1
  fi
  if ! issue_count="$(
    printf '%s' "$notary_log" | "$PACKAGER_BIN" notary-issue-count
  )"; then
    echo "無法解析 Apple notarization log：$submission_id" >&2
    printf '%s\n' "$notary_log" >&2
    exit 1
  fi
  if [[ "$notary_status" != "Accepted" || "$issue_count" -ne 0 ]]; then
    echo "Apple notarization gate 未通過（status=${notary_status:-missing}, issues=$issue_count）。" >&2
    printf '%s\n' "$notary_result" >&2
    printf '%s\n' "$notary_log" >&2
    exit 1
  fi
  echo "Apple notarization Accepted，log issues=0：$submission_id"
}

if [[ "$PACKAGE_PHASE" != "finalize" ]]; then
  cd "$PROJECT_DIR"
  env \
    -u CARGO_ENCODED_RUSTFLAGS \
    -u RUSTFLAGS \
    CARGO_TARGET_DIR="$PACKAGER_TARGET_DIR" \
    cargo build --release --locked --package gamercatch-release-packager

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
  cp "$PROJECT_DIR/README.md" "$OUTPUT_DIR/"
  cp "$PROJECT_DIR/LICENSE" "$OUTPUT_DIR/"
  cp "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$OUTPUT_DIR/"
  cp "$PROJECT_DIR/使用說明.txt" "$OUTPUT_DIR/"
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
fi

if [[ ! -x "$PACKAGER_BIN" ]]; then
  echo "找不到 Rust 發行包工具：$PACKAGER_BIN" >&2
  exit 1
fi

MACHO_PATHS=()
while IFS= read -r -d '' candidate; do
  if LC_ALL=C file -b "$candidate" | grep -F 'Mach-O' >/dev/null; then
    MACHO_PATHS+=("${candidate#"$OUTPUT_DIR/"}")
  fi
done < <(find "$OUTPUT_DIR" -type f -print0)
if [[ "${#MACHO_PATHS[@]}" -ne 2 ]]; then
  echo "發行包必須正好包含兩個已知 Mach-O，實際找到：${MACHO_PATHS[*]:-none}" >&2
  exit 1
fi
for expected_macho in GamerCatch playwright-driver/node; do
  expected_macho_found=0
  for actual_macho in "${MACHO_PATHS[@]}"; do
    if [[ "$actual_macho" == "$expected_macho" ]]; then
      expected_macho_found=1
      break
    fi
  done
  if [[ "$expected_macho_found" -ne 1 ]]; then
    echo "發行包缺少預期的 Mach-O：$expected_macho" >&2
    exit 1
  fi
done

if [[ "$PACKAGE_PHASE" == "prepare" ]]; then
  echo "macOS staging 已完成；尚未建立可發布的 ZIP。"
  exit 0
fi

if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "以 Developer ID 簽署 Rust 主程式與 Node：$SIGN_IDENTITY"
  codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp \
    --entitlements "$PROJECT_DIR/packaging/macos/Node.entitlements" \
    "$OUTPUT_DIR/playwright-driver/node"
  codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp \
    "$OUTPUT_DIR/GamerCatch"
  verify_developer_id_signature "$OUTPUT_DIR/playwright-driver/node"
  verify_developer_id_signature "$OUTPUT_DIR/GamerCatch"
else
  echo "預覽版狀態：已明確允許建立未簽章 macOS 版本。"
fi

"$PACKAGER_BIN" create-zip "$OUTPUT_DIR" "$PENDING_ZIP"
"$PACKAGER_BIN" validate --platform macos "$PENDING_ZIP"

if [[ -n "$NOTARY_PROFILE" || "$DIRECT_NOTARY_CONFIGURED" -eq 1 ]]; then
  submit_for_notarization "$PENDING_ZIP"
elif [[ -n "$SIGN_IDENTITY" ]]; then
  echo "預覽版狀態：已明確允許建立未公證 macOS 版本。"
fi

mv -- "$PENDING_ZIP" "$OUTPUT_ZIP"
echo "macOS 腳本發行包完成：$OUTPUT_ZIP"
