## 發行重點

v0.2.0 新增選用的 Gmail API 異常通知。任何已啟用遊戲發生巴哈排行／人氣找不到、頁面解析失敗、Google Sheets 找不到今日日期或更新失敗時，GamerCatch 會通知設定的負責人；成功執行、`dry-run` 及刻意設定 `write_to_google_sheets = false` 都不會寄信。

## 多遊戲、多人通知

- `[gmail_notifications].default_recipients` 可設定多位預設收件人。
- 每個 `[[games]]` 可用 `notification_recipients` 指定該遊戲自己的多位負責人；留空才使用預設收件人。
- 單一遊戲的排行／人氣格式異常會被個別記錄，其他遊戲仍繼續抓取與寫入，不會因一款遊戲失敗而整批停止。
- 同一位收件者每次執行最多收到一封彙整信。
- 郵件會逐位收件者分開寄送，因此不會暴露其他人的地址，也不會夾帶該收件者無關的遊戲錯誤。
- Gmail 寄送失敗只會補充寫入 log，不會蓋掉原始抓取或 Sheets 錯誤。

## Gmail 授權安全

- 使用 Google Desktop OAuth 2.0 Authorization Code、PKCE S256、隨機 `127.0.0.1` loopback port 與 CSRF `state` 驗證。
- 只申請 `https://www.googleapis.com/auth/gmail.send`，不要求讀取信件或完整信箱權限。
- refresh token 不寫入 TOML 或發行資料夾；它由 macOS Keychain 或 Windows Credential Manager 保存。
- Gmail OAuth JSON 與 Google Sheets service account JSON 是兩種不同憑證，不可混用。
- 一份 `config.toml` 使用一個寄件 Gmail，但可通知多位收件人；若要用不同寄件帳號，請使用不同設定檔與程式資料夾。
- refresh token 綁定目前的 macOS／Windows 登入帳號；每位系統使用者、每台新電腦都必須各自執行首次授權，授權不會隨 ZIP 或設定檔複製。
- 一般執行及 Windows 每日排程只會使用既有授權，不會突然開啟瀏覽器。授權缺失、被撤銷或失效時，log 會要求重新執行首次授權。

## 零基礎操作

兩平台 ZIP 都新增：

- macOS：`Gmail_首次授權.command`
- Windows：`Gmail_首次授權.cmd`

請先依新版 PDF 手冊啟用 Gmail API、建立「電腦版應用程式」OAuth 用戶端、填好 TOML，再雙擊此檔完成瀏覽器授權及測試信。Windows 使用者應在安裝每日 09:00 排程前先收到測試信。

若 Google Auth Platform 的 External audience 仍停在 Testing，含 Gmail scope 的 refresh token 通常 7 天後失效，不適合長期無人值守排程；請依帳號類型選擇 Workspace Internal，或完成適用的 In production／驗證設定。

## 升級方式

1. 下載並完整解壓縮 v0.2.0 對應平台 ZIP。
2. 安全複製舊版 `config.toml` 與 `credentials` 內容到新版資料夾。
3. 參考新版 `config.example.toml`，把 `[gmail_notifications]` 及各遊戲的 `notification_recipients` 加入既有設定；不需要通知時保持 `enabled = false`。
4. 先手動執行抓取。要啟用 Gmail 時，再完成首次授權與測試信。
5. Windows 若使用每日排程，請在新版資料夾重新雙擊 `3_安裝每天早上9點自動抓取.cmd`，讓既有 Task 更新到新版路徑。

既有 schema version 2 設定仍相容；未加入 Gmail 區塊時預設不啟用通知。

## 限制與注意事項

- 設定檔本身無法讀取／解析、程式根本未啟動、電腦關機或網路完全中斷時，程式可能沒有能力透過 Gmail API 寄信，請仍定期查看 `last-run.log` 或 `last-scheduled-run.log`。
- Gmail API 成功接受郵件不等於最終投遞一定成功；仍可能被退信或分類到垃圾郵件。
- 本版仍是未完成 macOS Developer ID／公證及 Windows Authenticode 簽章的預覽版。請只從本 repository 的 Release 下載並核對 `SHA256SUMS.txt`。
- 不要把 OAuth JSON、service account JSON、log 或作業系統憑證匯出後上傳到 GitHub 或提供給不受信任的人。

## 相關連結

- 完整變更紀錄：https://github.com/Willseed/gamer-catch-rust/compare/v0.1.2...v0.2.0
- Gmail API `gmail.send` 權限：https://developers.google.com/workspace/gmail/api/auth/scopes
- Desktop OAuth：https://developers.google.com/identity/protocols/oauth2/native-app
