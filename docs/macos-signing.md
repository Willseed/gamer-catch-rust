# macOS Developer ID 簽章與 Apple 公證

正式 Release 的 macOS arm64 ZIP 內所有 Mach-O 都必須通過 Developer ID Application 簽章，
最終 ZIP 必須取得 Apple notarization 的 `Accepted` 結果且 log issues 為 0。Release workflow
採 fail-closed：缺少任一憑證、私鑰或識別資料時，macOS job 會停止，不會回退成未簽章或未公證的
發行包。

## 1. 準備 Apple 憑證

1. 確認 Apple Developer Program 會員資格有效。
2. 在 Apple Developer 的 Certificates, Identifiers & Profiles 建立
   `Developer ID Application` 憑證。依 Apple 畫面要求上傳由 Keychain Access 產生的 CSR。
3. 下載並安裝 `.cer`，確認憑證與對應 private key 同時出現在登入 Keychain。
4. 從 Keychain Access 匯出只包含這張 Developer ID Application 憑證及其 private key 的
   password-protected `.p12`。不要把其他個人憑證一起匯出。
5. 在 App Store Connect 的 Users and Access → Integrations 建立 notarization 使用的 Team API
   key，下載一次性的 `AuthKey_*.p8`，並記下 Key ID 與 Issuer ID。
6. 記下 10 碼 Apple Developer Team ID。Release workflow 會用它拒絕錯誤團隊的簽章。

請勿把 `.p12`、`.p8`、密碼或其 Base64 內容貼到 issue、聊天、設定檔或 repository。

## 2. 建立受保護的 GitHub Environment

在 repository Settings → Environments 建立 `release`。建議設定 required reviewer，並把 Apple
資料只放在這個 environment，不要放進一般變數或 workflow YAML。

Environment secrets：

| 名稱 | 內容 |
| --- | --- |
| `MACOS_DEVELOPER_ID_P12_BASE64` | `.p12` 完整檔案的 Base64 |
| `MACOS_DEVELOPER_ID_P12_PASSWORD` | 匯出 `.p12` 時設定的密碼 |
| `APPLE_NOTARY_KEY_P8_BASE64` | `AuthKey_*.p8` 完整檔案的 Base64 |
| `APPLE_NOTARY_KEY_ID` | 10 碼 App Store Connect API Key ID |
| `APPLE_NOTARY_ISSUER_ID` | Team API key 的 Issuer UUID |

Environment variable：

| 名稱 | 內容 |
| --- | --- |
| `APPLE_TEAM_ID` | 10 碼 Apple Developer Team ID |

可從本機使用 GitHub CLI 上傳檔案，不必把內容放進命令列參數：

```bash
base64 < "/absolute/path/DeveloperIDApplication.p12" |
  gh secret set MACOS_DEVELOPER_ID_P12_BASE64 --env release

base64 < "/absolute/path/AuthKey_XXXXXXXXXX.p8" |
  gh secret set APPLE_NOTARY_KEY_P8_BASE64 --env release

gh secret set MACOS_DEVELOPER_ID_P12_PASSWORD --env release
gh secret set APPLE_NOTARY_KEY_ID --env release
gh secret set APPLE_NOTARY_ISSUER_ID --env release
gh variable set APPLE_TEAM_ID --env release --body "YOURTEAMID"
```

沒有透過 pipe 傳值的 `gh secret set` 會安全等待標準輸入。輸入 `.p12` 密碼、Key ID 或 Issuer
ID 後按 Control-D 結束；不要把值加入 shell history。完成後只檢查名稱是否存在：

```bash
gh secret list --env release
gh variable list --env release
```

在建立正式版本 tag 前，先從已通過 main CI 的最新 commit 手動執行簽章 smoke test：

```bash
gh workflow run release.yml --ref main
gh run list --workflow release.yml --event workflow_dispatch --limit 1
```

手動執行會建立、簽署、公證並驗證 macOS 候選包，再從同一 commit SHA 的成功 main CI run 下載
已驗證的 Windows 候選包。兩份 ZIP 會在 Linux runner 再次通過 Rust 驗證後，合併成名稱包含 SHA
的不可變 Release Candidate artifact；不會因 smoke test 發布 GitHub Release。smoke test 必須成功後，
才能建立正式 release tag。

`v*` tag workflow 會要求 tag、目前 main、成功 main CI、成功 smoke run 與 Release Candidate 全部
綁定同一 SHA，並拒絕過期、空白、缺少 SHA-256 digest 或來源 run 不符的 artifact。正式發布直接
重用 smoke test 已驗證的兩份 ZIP，不會重新建立 Windows 套件，也不會再次簽署或送交 Apple 公證；
發布前仍會重新執行 Rust 套件驗證並產生新的 `SHA256SUMS.txt`。publish job 保留 `release`
environment 閘門，因此推送 tag 不會繞過既有的發行審批設定。

同一 SHA 若有多次成功的 smoke run，tag workflow 會選擇建立時間最新的一次，並繼續以該 run 的
成功 audit job attempt、artifact ID 與 digest 鎖定候選包。Windows、macOS 與合併候選 artifact
均保留 14 天，因此正式 tag 必須在候選包到期前建立。

## 3. Release workflow 的安全界線

macOS Release Candidate job 會依序：

1. 不注入任何 Apple secret，完成主程式、Rust 發行包工具、Playwright driver 與 staging 目錄建置。
2. 將 `.p12` 與 `.p8` 解碼到 `$RUNNER_TEMP`，建立短效 temporary Keychain。
3. 以不可匯出的方式匯入 private key，只授權 Apple signing tools／`codesign` 使用。
4. 要求 temporary Keychain 中正好有一張 Developer ID Application identity。
5. 簽署 `playwright-driver/node` 與 `GamerCatch`，逐一驗證 Developer ID authority、hardened
   runtime、secure timestamp 與 Team ID；發現額外 Mach-O 時會停止。
6. 由 Rust 工具建立並驗證 `.pending.zip`，再以 App Store Connect API key 執行
   `notarytool submit --wait`；公證 JSON 同樣由 Rust 嚴格解析，只有 `Accepted` 且 notarization
   log 的 `issues` 為 0，才會原子改名為正式 ZIP，避免失敗時留下看似可發佈的檔案。
7. cleanup step 使用 `if: always()` 刪除 temporary Keychain、`.p12` 與 `.p8`，再執行套件驗證；GitHub-hosted
   runner 結束後，ephemeral VM 也會被銷毀。

接著 audit job 只從 exact-SHA main CI 取得 Windows ZIP，下載同一次 smoke run 的 macOS ZIP，確認
兩個 action artifact 的 digest，並以 Rust 驗證兩平台內容後上傳合併候選包。Linux
`gamercatch-release-packager` 只在來源驗證 job 建置一次；audit 與 publish 都以同一次 workflow 的
artifact ID 下載、核對 digest、檢查唯一檔案並恢復執行權限，不再安裝 Rust 或重新編譯。tag publish
job 只下載這個成功 smoke run 的合併候選包；任何 run ID、head SHA、artifact 名稱、有效期限、大小
或 digest 不符都會 fail closed。

Release workflow 不允許 `ALLOW_UNSIGNED_MACOS=1` 或 `ALLOW_UNNOTARIZED_MACOS=1`。

## 4. 本機封裝

本機已有 Developer ID Application 時，`package-macos.sh` 會自動選取唯一的一張 identity。
公證可使用既有 Keychain profile：

```bash
MACOS_NOTARY_PROFILE="GamerCatch" ./scripts/package-macos.sh
```

或直接使用 App Store Connect API key：

```bash
MACOS_NOTARY_KEY_PATH="/absolute/path/AuthKey_XXXXXXXXXX.p8" \
MACOS_NOTARY_KEY_ID="XXXXXXXXXX" \
MACOS_NOTARY_ISSUER_ID="00000000-0000-0000-0000-000000000000" \
MACOS_EXPECTED_TEAM_ID="YOURTEAMID" \
./scripts/package-macos.sh
```

`MACOS_PACKAGE_PHASE=prepare`／`finalize` 是 CI 用的內部分階段；一般本機封裝不要自行使用。

## 5. 驗收與 ZIP 限制

下載 Release 的實際 ZIP，而不是只檢查 staging 目錄。解壓後至少驗證：

```bash
codesign --verify --strict --verbose=2 "/path/to/GamerCatch"
codesign --verify --strict --verbose=2 "/path/to/playwright-driver/node"
codesign --display --verbose=4 "/path/to/GamerCatch"
codesign --display --verbose=4 "/path/to/playwright-driver/node"
```

兩個 Mach-O 都必須顯示 Developer ID Application、`runtime`、`Timestamp` 與預期 Team ID。
也必須核對 Release 的 `SHA256SUMS.txt`，並在保留 quarantine 的乾淨 Mac／新帳號上逐一測試實際
下載的入口。

Apple `stapler` 不支援 ZIP；它只支援 DMG、已簽章 executable bundle 與 signed flat installer
package。ZIP 可送 notarization，但 Gatekeeper 需要連線取得 ticket。三支 `.command` 是 loose
Bash scripts，無法只靠簽署內部兩個 Mach-O 就保證每個 macOS 版本都完全不顯示第一次執行提示。
若產品要求可離線 staple 且穩定直接雙擊，應另行改成已簽章 `.app`，再放入已公證並 staple 的 DMG
或 PKG；不得以 `xattr`、`spctl --master-disable` 等方式繞過 Gatekeeper。
