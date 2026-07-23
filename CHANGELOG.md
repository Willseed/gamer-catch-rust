# Changelog

## Unreleased

- 下載頁移除 Angular Blob 與 Cloudflare 代理下載，改為直接連到官方 GitHub Release，由瀏覽器原生管理下載進度與安全檢查。

## 0.2.2 - 2026-07-23

- macOS arm64 發行包內的 `GamerCatch` 與 Playwright 隨附 Node 改用 Developer ID Application 簽章，並驗證 hardened runtime、secure timestamp 與 Developer Team ID。
- macOS ZIP 只有在 Apple 公證回傳 `Accepted` 且 log issues 為 0 後才會發布；缺少簽章或公證資料時採 fail-closed，不會退回未簽章版本。
- 強化簽章憑證隔離與清理：建置完成後才注入憑證，使用短效 temporary Keychain，並在所有結果下刪除 `.p12`、`.p8` 與 Keychain。
- Google Cloud Gmail OAuth 教學改用目前介面的繁體中文名稱，補充「電腦版應用程式」用戶端與 JSON 下載時機。
- 重構發行 ZIP 驗證程式，降低認知複雜度並集中重複常數，同時保留既有安全檢核。
- Windows x64 仍未使用 Authenticode 簽章，SmartScreen 可能顯示未知發行者；macOS ZIP 無法 staple，且 `.command` 為獨立 shell script，仍不能保證所有環境第一次執行都不顯示 Gatekeeper 提示。

## 0.2.1 - 2026-07-22

- 新增 Angular 22／TypeScript 6 網站與零程式設定產生器，支援多遊戲、多 Google Sheets、多人帳號與多人 Gmail 收件人。
- 新增高對比 PlayStation-inspired 首頁、自動辨識平台與顯示進度的下載頁，以及可用 `#fragment` 直接分享的完整繁中線上教學；Linux 會明確提示目前不支援且不會開始下載。
- 移除 PDF 手冊與發行資產，改以 `https://gamer-catch.pylot.dev` 作為唯一教學來源；首次設定只開啟 `credentials` 資料夾與線上指南，不再開啟 TOML 編輯器。
- 發行 ZIP 不再附帶可被誤覆寫的 `config.toml`，只保留安全的 `config.example.toml`；首次設定、開始抓取與 Gmail 授權腳本都不會建立或覆蓋使用者設定，缺少設定時會引導至網頁產生器。
- 大幅補強 Gmail Desktop OAuth 新手教學，逐步說明 Gmail API、Branding、Audience、Test users、最小 `gmail.send` scope、Desktop client 與 JSON 放置方式，並保留 External Testing 權杖通常七天失效的提醒。
- 設定產生器會在同一瀏覽器的 Local Storage 自動保留草稿 30 天，提供清除草稿功能，並限制版本、期限、欄位型別、長度與總大小；草稿不包含 JSON 憑證內容，也不會傳送至伺服器。
- 設定產生器會在下載或複製前檢核所有必填欄位，平滑定位至最上方未完成欄位；service account 與 Gmail OAuth 只接受 JSON 檔名，遊戲專用通知收件人會安全同步至預設收件人。
- 新增 Node.js 24 網站 CI、Cloudflare Pages deployment workflow、安全標頭、SPA fallback 與 custom-domain 檢查。
- 更新 macOS／Windows 發行腳本、ZIP 驗證、README 與離線說明，並收斂 Web 與 Rust 重複測試；保留 TOML、憑證路徑、Google Sheets 目標、OAuth、下載完整性與導覽等高風險契約。
- macOS 發行包目前仍未使用 Developer ID 簽章及 Apple 公證，因此第一次執行 `.command` 仍可能需要由 Finder 核准；本版不會停用或繞過 Gatekeeper。

## 0.2.0 - 2026-07-21

- 新增 Gmail API 異常通知：巴哈抓取、排行／人氣解析及 Google Sheets 更新未完成時寄信，成功與 dry-run 不寄信。
- 使用 Desktop OAuth 2.0、PKCE、隨機 loopback port 與最小 `gmail.send` 權限；refresh token 存入 macOS Keychain／Windows Credential Manager。
- 支援全域預設及每個遊戲各自的多位收件人；每位收件者收到獨立彙整信，不會看到其他人的地址或無關遊戲錯誤。
- 單一遊戲的排行／人氣格式異常時會記錄該遊戲失敗並繼續處理其他遊戲，不再中止整批更新。
- macOS／Windows 發行包新增可雙擊的 Gmail 首次授權及測試信腳本，正常執行與 Windows 排程不會互動開啟授權頁。
- 更新安全範例 TOML、README、文字說明、兩平台零基礎 PDF 手冊、CI 與 ZIP 驗證。

## 0.1.2 - 2026-07-21

- 修正 Windows 排程安裝成功後，繁體中文訊息尾端被 `cmd.exe` 誤判為指令並顯示亂碼的問題。
- Windows 兩支雙擊執行入口不再把 UTF-8 中文輸出放在 CMD 括號區塊內，避免同型解析問題。
- CI 會在 Windows 真正執行排程安裝 CMD，嚴格檢查 UTF-8 訊息、結束碼及 Task Scheduler 行為。
- ZIP 驗證與零基礎手冊新增排程安裝亂碼的回歸保護及處理說明。

## 0.1.1 - 2026-07-21

- Windows 新增免系統管理員權限的一鍵 Task Scheduler 安裝器，每天本機時間 09:00 自動抓取所有已啟用遊戲。
- 排程以目前 Windows 帳號的標準權限執行，支援錯過時間後補跑、睡眠喚醒設定與重複安裝更新。
- 自動執行使用獨立 `last-scheduled-run.log`，不會呼叫含有暫停提示的手動執行腳本。
- Windows ZIP 新增排程 PowerShell 與第 3 個雙擊 `.cmd`，並擴充 CI、打包與 ZIP 安全驗證。
- macOS 與 Windows 零基礎手冊新增「更換遊戲」章節；Windows 另新增每日 09:00 排程章節。

## 0.1.0 - 2026-07-21

- 首次發布 Rust + Playwright 巴哈手機遊戲排行抓取工具。
- 支援多遊戲、多人 service account、多張 Google Sheets。
- 提供 macOS 與 Windows 雙擊腳本發行包。
- 提供 macOS、Windows 零基礎設定 PDF 手冊。
- 加入跨平台 CI、原生平台封裝、checksum 與 GitHub Release 流程。
