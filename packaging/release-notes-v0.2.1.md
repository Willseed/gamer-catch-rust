## 發行重點

v0.2.1 重新整理第一次使用流程，將下載、設定產生器與線上教學串成單一路徑，並把「絕不覆蓋使用者的 `config.toml`」設為發行腳本與 CI 的安全契約。設定產生器現在也會在這台瀏覽器保留草稿，切換教學章節後可以繼續填寫。

## 第一次使用與設定檔保護

- 完整教學統一放在 <https://gamer-catch.pylot.dev/guide#quick-start>；macOS／Windows ZIP 不再附 PDF。
- 發行 ZIP 不再附帶可直接執行的 `config.toml`，只保留不會被程式自動採用的 `config.example.toml`。請由[設定產生器](https://gamer-catch.pylot.dev/generator)下載自己的 `config.toml`，放到 GamerCatch 資料夾最外層。
- `1_首次設定` 只會準備 Chromium、建立／開啟 `credentials` 資料夾並打開線上指南，不會打開 TOML 編輯器，也不會建立或修改 `config.toml`。
- `2_開始抓取` 與 `Gmail_首次授權` 找不到 `config.toml` 時會停止並顯示設定產生器網址，不再複製範例檔或打開文字編輯器。
- 若資料夾中已經有自己的 `config.toml`，首次設定、抓取與 Gmail 授權腳本都會原樣保留；CI 會以 SHA-256 驗證腳本執行前後內容相同。

## Gmail Desktop OAuth 新手教學

- 「建立 Gmail OAuth」章節改成逐步流程，先說明最後應取得的檔案，再帶領使用者確認寄件帳號與 Google Cloud 專案。
- 新增 Gmail API 啟用、Google Auth Platform Branding、Internal／External Audience、External Testing 的 Test users、Data Access 與 Clients 操作說明。
- 明確要求只加入 `https://www.googleapis.com/auth/gmail.send`，OAuth client 類型必須是 Desktop app（電腦版應用程式）；Sheets service account、API key 與 Web client 都不能替代。
- 補上 JSON 下載、改名為 `gmail-oauth-client.json`、放入 `credentials` 及產生器只填檔名的完整檢查表。
- External audience 若仍是 Testing，包含 Gmail scope 的 refresh token 通常七天後失效；長期排程請依帳號情況使用 Workspace Internal，或完成適用的 In production／驗證設定。

## 設定產生器草稿與檢核

- 表單變更會在短暫延遲後儲存在同一網站、同一瀏覽器的 Local Storage；離開頁面時也會立即保存，回到產生器可自動恢復。
- 草稿保留 30 天，並限制為 64 KiB、最多 20 個遊戲；版本不符、過期、時間異常、格式錯誤、欄位型別或長度超限的資料會被拒絕並清除。
- 頁面會清楚列出草稿包含遊戲名稱、試算表網址或 ID、憑證檔名及通知電子郵件，並提供「清除草稿並重新開始」。共用電腦使用完畢後請主動清除。
- Local Storage 不是加密保管庫。產生器只接受 JSON 檔名，不讀取或保存 service account／Gmail OAuth JSON 內容；請勿貼上 private key、client secret 或 token。
- 下載或複製設定前會檢查所有必填欄位；若有多項未完成，會展開需要的區塊、平滑捲動並聚焦最上方的問題欄位。
- 遊戲專用通知收件人會同步加入預設收件人，保留手動地址並以不分大小寫方式去重；修改、停用或移除遊戲時也會清理不再需要的自動同步地址。

## 網站與下載

- 新增 Angular 22／TypeScript 6 網站、設定產生器及可用 `#fragment` 分享的繁體中文教學。
- 下載頁會自動辨識 Windows x64 或 Apple Silicon macOS，只顯示適用於目前電腦的下載動作，並顯示實際 HTTP 下載進度。
- Linux、行動裝置、iPad、ChromeOS 與其他未支援平台不會開始下載；Linux 會顯示自動消失的支援提示。
- 下載端點失敗時提供官方 GitHub Release 連結；HTML 錯誤頁即使回傳成功狀態，也不會被當成 ZIP 儲存。

## 測試與安全閘門

- Web 測試由 103 個重複或文案導向案例收斂為 32 個高風險契約；Rust 測試也合併重複排列，但保留所有關鍵輸入與邊界。
- 保留 TOML 字串注入防護、憑證路徑穿越、電子郵件格式、Google Sheets URL authority confusion、跨遊戲欄位碰撞、OAuth callback、私人收件人、日期解析、下載完整性與 deep link 導覽等安全驗證。
- macOS 與 Windows CI 會驗證既有 `config.toml` 不被修改、缺檔時不自動建立、發行 ZIP 不含 `config.toml` 或 PDF，且只包含一份安全的 `config.example.toml`。

## macOS 簽章限制

- 本版 macOS ZIP 仍是未使用 Developer ID 簽章、也未送 Apple 公證的預覽版本，因此無法保證第一次雙擊 `.command` 就直接執行。
- 從官方 Release 下載並核對 `SHA256SUMS.txt` 後，可先在 Finder 按住 Control 點擊 `.command` 並選「打開」；部分 macOS 版本可由此完成核准，不必進入系統設定。若 Gatekeeper 仍阻擋，仍可能需要到「隱私權與安全性」選擇「仍要打開」。
- GamerCatch 不會執行 `xattr`、`spctl` 或其他停用／繞過 Gatekeeper 的指令。要完全移除這個首次核准步驟，未來發行包必須使用有效的 Developer ID 簽章並完成 Apple 公證。

Windows 發行包同樣尚未使用 Authenticode 簽章，SmartScreen 可能顯示未知發行者。兩個平台都請只從 `Willseed/gamer-catch-rust` 的 GitHub Release 下載並核對 SHA-256。

## 從 v0.2.0 升級

1. 下載 v0.2.1 對應平台 ZIP，核對 SHA-256 後完整解壓縮到新的資料夾；不要直接覆蓋舊資料夾。
2. 將舊資料夾中已確認可用的 `config.toml` 與整個 `credentials` 資料夾安全複製到新版資料夾。新版套件本身沒有 `config.toml`，不會與您的設定衝突。
3. 執行 `1_首次設定` 準備 Chromium；這一步不會打開或修改剛複製的設定。
4. 先執行一次不寫入測試，確認遊戲、排行、人氣與試算表目標正確，再恢復正式寫入。
5. Windows 若使用每日排程，請在新版資料夾重新執行 `3_安裝每天早上9點自動抓取.cmd`，讓既有 Task 更新到 v0.2.1 路徑。

既有 schema version 2 設定仍相容，不需要為本次升級重建 TOML。

## 相關連結

- 完整變更紀錄：<https://github.com/Willseed/gamer-catch-rust/compare/v0.2.0...v0.2.1>
- 線上教學：<https://gamer-catch.pylot.dev/guide#quick-start>
- 設定產生器：<https://gamer-catch.pylot.dev/generator>
- Gmail OAuth 教學：<https://gamer-catch.pylot.dev/guide#gmail-oauth>
