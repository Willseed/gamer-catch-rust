## 發行重點

GamerCatch 首個可下載版本，以雙擊腳本為入口，不需要安裝 Rust 或撰寫程式。一次掃描巴哈手機遊戲排行，支援多個遊戲、多人帳號、不同 service account JSON 與不同 Google 試算表。

## 下載

- Apple Silicon Mac：`GamerCatch-macOS-arm64.zip`
- 一般 Intel／AMD Windows：`GamerCatch-Windows-x64.zip`
- 兩個平台各有一份獨立的 17 頁「零基礎使用手冊」PDF。
- `SHA256SUMS.txt` 可用來核對下載檔完整性。

請完整解壓縮後，先雙擊 `1_首次設定`，再依 PDF 填寫 `config.toml` 與 `credentials`，日後雙擊 `2_開始抓取` 即可。

## 新增

- 一次抓取最多 20 個遊戲，每個排行頁只解析一次。
- 每個遊戲可使用不同 Google Cloud service account、試算表、工作表、時區與欄位。
- 同一款遊戲可分別寫入多人的試算表，不重複抓取。
- 單一遊戲找不到、單一 JSON 壞掉或單一 Sheets 更新失敗時，其他遊戲仍會繼續。
- macOS `.command` 與 Windows `.cmd` 雙擊腳本，首次自動準備 Chromium，執行後保留視窗與 `last-run.log`。
- Google Sheets 日期採完整年份比對；找不到今天或日期重複時不會猜測寫入位置。

## 文件

- 兩份平台化 PDF 涵蓋 Google Sheets API、service account JSON、試算表分享、多遊戲設定、安全測試與錯誤排除。
- 範例設定預留三個遊戲，預設不寫入 Google Sheets。

## 驗證

- Rust format、check、unit tests 與 Clippy 在 Linux、macOS、Windows 執行。
- 發行包在原生 macOS arm64 與 Windows x64 runner 建置。
- Playwright driver 下載會驗證 npm SHA-512 與 Node.js SHA-256，並優先使用發行包隨附 driver。
- 發行流程驗證 ZIP 必要檔案、安全設定、空白 credentials，並提供 SHA-256 checksum。

## 重要安全說明

這是功能完整但尚未完成兩平台正式簽章的預覽版：

- macOS 成品目前未使用 Developer ID Application 簽章，也未送 Apple notarization。
- Windows 成品目前未使用 Authenticode 憑證簽章。
- 兩個平台第一次執行都可能顯示安全警告。請只從本 repository 的 GitHub Release 下載並核對 checksum；不要關閉 Gatekeeper、防毒或 SmartScreen。
- repository 目前為 Public，任何人都能下載；請勿把填入帳號資訊的設定檔或 JSON 金鑰重新上傳。

待 Developer ID 憑證與 notarytool profile 可供建置環境使用，以及取得 Windows 公開信任 Authenticode 憑證後，再發布正式簽章版。

## 相關連結

- 完整提交紀錄：https://github.com/Willseed/gamer-catch-rust/commits/v0.1.0
- Apple Developer ID：https://developer.apple.com/support/developer-id/
- Microsoft SmartScreen reputation：https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
