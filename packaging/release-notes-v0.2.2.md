## 發行重點

v0.2.2 是首個讓 macOS arm64 發行包內的 `GamerCatch` 與 Playwright 隨附 Node 使用 Developer ID Application 簽章，並將 ZIP 送交 Apple 公證的版本。macOS 發行包只有在 Apple 回傳 `Accepted` 且公證 log issues 為 0 後才會發布。

Windows x64 發行包仍未使用 Authenticode 簽章，因此本版並非兩個平台皆已簽章的版本。

## macOS Developer ID 簽章與 Apple 公證

- 使用 Developer ID Application 簽署 ZIP 內兩個 Mach-O：`GamerCatch` 與 `playwright-driver/node`。
- 每個執行檔都會驗證 Developer ID authority、hardened runtime、secure timestamp 與預期的 Developer Team ID。
- 發行包出現未知或額外的 Mach-O 時會停止，不會將未納入簽章規則的執行檔發布。
- ZIP 先以 `.pending.zip` 建立並送交 Apple；只有公證狀態為 `Accepted` 且 log issues 為 0，才會原子改名為正式下載檔。
- 缺少憑證、私鑰、公證資料或任何驗證失敗時，macOS Release job 會直接失敗，不會回退成未簽章或未公證版本。

## 憑證與發行流程保護

- Rust、Playwright driver 與 staging 目錄會在尚未注入 Apple 憑證時完成建置。
- Developer ID 憑證匯入短效 temporary Keychain，private key 設為不可匯出並只授權簽章工具使用。
- `.p12` 會在匯入後立即刪除；cleanup step 不論前面成功或失敗，都會刪除 temporary Keychain、`.p12` 與公證 `.p8`。
- 手動簽章 smoke test 只產生 macOS 測試 artifact，不會建立 Windows ZIP 或發布 GitHub Release。

## Gmail OAuth 教學

- Google Cloud 操作名稱改用目前介面的繁體中文，包括「API 程式庫」、「品牌」、「目標對象」、「資料存取權」、「用戶端」與「電腦版應用程式」。
- 明確區分 Gmail OAuth 用戶端、Sheets 服務帳戶與 API 金鑰，避免建立錯誤的憑證類型。
- 補充 OAuth 用戶端完成畫面的 JSON 下載時機；檔案遺失時應建立新的專用電腦版用戶端。
- 保留最小 `gmail.send` 權限、外部測試使用者與更新權杖期限等安全提醒。

## 內部品質

- 重構發行 ZIP 驗證程式，降低認知複雜度並集中重複常數。
- 保留既有 ZIP 路徑安全、TOML、使用者設定檔及 Windows 啟動腳本等發行契約；發行包仍不得包含 PDF 或 `config.toml`，只允許安全的 `config.example.toml`。
- CI 會阻止正式 macOS workflow 啟用未簽章或未公證的預覽開關。

## macOS ZIP 與 Gatekeeper 限制

- ZIP 本身不是 Developer ID code-signing 的簽章載體；本版簽署的是 ZIP 內的 Mach-O，並將 ZIP 送交 Apple 公證。
- Apple `stapler` 不支援 ZIP，因此 Gatekeeper 可能需要連線向 Apple 取得公證 ticket。
- 三支 `.command` 是獨立的 shell script。即使內部執行檔已簽章且 ZIP 已取得公證接受結果，也不能保證所有 macOS 版本、網路或組織安全政策下第一次雙擊都完全不顯示提示。
- GamerCatch 不會使用 `xattr`、`spctl --master-disable` 或其他方式停用、移除或繞過 Gatekeeper。
- 若未來要求可離線 staple 且穩定直接雙擊，需另行改為已簽章 `.app`，再封裝成已公證並 staple 的 DMG 或 PKG。

## Windows 簽章限制

Windows x64 發行包仍未使用 Authenticode 簽章，SmartScreen 可能顯示未知發行者。請只從 `Willseed/gamer-catch-rust` 的 GitHub Release 下載，並核對 `SHA256SUMS.txt`；不要停用 SmartScreen、防毒或公司安全政策。

## 從 v0.2.1 升級

1. 下載 v0.2.2 對應平台 ZIP，核對 SHA-256 後完整解壓縮到新的資料夾。
2. 將舊資料夾中已確認可用的 `config.toml` 與整個 `credentials` 資料夾安全複製到新版資料夾。
3. 執行 `1_首次設定` 準備 Chromium；這一步不會建立或覆蓋既有 `config.toml`。
4. 先手動執行一次不寫入測試，再恢復正式寫入。
5. Windows 若使用每日排程，請在新版資料夾重新執行 `3_安裝每天早上9點自動抓取.cmd`，讓既有 Task 更新到 v0.2.2 路徑。

本次沒有變更設定檔 schema；既有 schema version 2 設定仍相容。

## 相關連結

- 完整變更紀錄：<https://github.com/Willseed/gamer-catch-rust/compare/v0.2.1...v0.2.2>
- macOS 簽章與公證說明：<https://github.com/Willseed/gamer-catch-rust/blob/v0.2.2/docs/macos-signing.md>
- 線上教學：<https://gamer-catch.pylot.dev/guide#quick-start>
- Gmail OAuth 教學：<https://gamer-catch.pylot.dev/guide#gmail-oauth>
