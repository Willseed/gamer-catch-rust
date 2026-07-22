# GamerCatch

GamerCatch 是 Windows／macOS 工具，使用 Rust 與 Playwright 一次掃描巴哈姆特手機或 PC 遊戲排行，取得多款遊戲的「排行」與「人氣」，再分別寫入不同人的 Google Sheets。抓取或寫入異常時，可透過 Gmail API 通知每款遊戲的負責人。

使用者不需要修改程式碼。設定檔、完整教學與下載入口統一放在 [gamer-catch.pylot.dev](https://gamer-catch.pylot.dev/)：

- [設定檔產生器](https://gamer-catch.pylot.dev/generator)
- [第一次使用教學](https://gamer-catch.pylot.dev/guide#quick-start)
- [多遊戲與多帳號](https://gamer-catch.pylot.dev/guide#multiple-games-and-accounts)
- [Google Sheets 與 service account](https://gamer-catch.pylot.dev/guide#prepare-google-sheet)
- [Gmail 異常通知](https://gamer-catch.pylot.dev/guide#gmail-api)
- [更換遊戲檢查表](https://gamer-catch.pylot.dev/guide#change-game)
- [Windows 每日 9 點排程](https://gamer-catch.pylot.dev/guide#windows-scheduled-task)
- [下載 macOS／Windows ZIP](https://gamer-catch.pylot.dev/downloads)

完整操作說明統一由線上教學維護，發行 ZIP 不附 PDF。ZIP 內的 `使用說明.txt` 只保留必要的離線安全提醒與線上教學入口，避免同時維護多份不同版本的說明。

## 功能

- 一份 `config.toml` 最多設定 20 個遊戲。
- 每個遊戲可使用不同的 Google Sheet、工作表、欄位、service account JSON 與通知收件人。
- 同一遊戲也能建立多個區塊，分別寫給不同人的試算表。
- Gmail 使用寄件者 OAuth 2.0；Google Sheets 使用 service account，兩種憑證不混用。
- Windows ZIP 內含無需管理員權限的每日 09:00 工作排程安裝器。
- macOS 與 Windows 都能用雙擊腳本完成第一次設定、授權與日常抓取。
- 網頁產生器不會上傳表單，也不會要求貼上 JSON 密鑰；未完成內容會在本機瀏覽器的 Local Storage 保留 30 天。Local Storage 不是加密保管庫，共用電腦使用完畢後請清除草稿。

目前正式發行目標為 Apple Silicon macOS（arm64）與 Windows x64。Intel Mac 與 Windows on ARM 尚未提供發行包。

## 一般使用者快速開始

1. 到[下載頁](https://gamer-catch.pylot.dev/downloads)，讓頁面自動取得這台電腦適用的版本，再完整解壓縮 ZIP。
2. macOS 雙擊 `1_首次設定.command`；Windows 雙擊 `1_首次設定.cmd`。腳本會準備 Chromium，並開啟 `credentials` 資料夾與線上教學，不會打開或修改 `config.toml`。
3. 依[線上教學](https://gamer-catch.pylot.dev/guide#prepare-google-sheet)準備 Google Sheet 與 JSON。
4. 用[設定檔產生器](https://gamer-catch.pylot.dev/generator)下載 `config.toml`，放到解壓縮資料夾最外層。
5. 第一次保持 `write_to_google_sheets = false`，先確認抓到正確的遊戲、排行與人氣。
6. 確認無誤後才開啟對應遊戲的 Sheets 寫入。

不要直接在 ZIP 裡執行，也不要把填過的 `config.toml`、service account JSON、Gmail OAuth JSON 或任何 token 上傳到 GitHub、公開雲端或問題回報。

## 設定格式

安全範例在 [config.example.toml](config.example.toml)。一個 `[[games]]` 區塊代表一個輸出關係：

> 一個遊戲 → 一張 Google Sheet → 一份 service account 憑證 → 一組通知收件人

程式先驗證所有啟用設定，再只掃描每個 `page=n` 一次，同時尋找尚未找到的所有遊戲。某個遊戲抓取或寫入失敗時，其他遊戲仍會繼續，最後才彙整結果與通知。

`[bahamut]` 的 `category` 決定排行榜來源：`30` 是手機排行榜，`500` 是 PC 排行榜。這個欄位由整份設定共用，因此同一份 `config.toml` 中的啟用遊戲必須位於同一排行榜；更換遊戲平台時也要一併修改並重新執行不寫入測試。

舊版單遊戲的 `[game]`／`[google_sheets]` 仍可讀取，但啟動時會提示改成 `schema_version = 2` 與 `[[games]]`。

## 從原始碼執行

需求：Rust 1.88 以上。Playwright 的作業系統需求請見[官方說明](https://playwright.dev/docs/intro#system-requirements)。

macOS／Linux shell：

```bash
cp config.example.toml config.toml
cargo run -- --install-browser
cargo run -- --config config.toml --dry-run
# 只有啟用 Gmail 通知時才需要：
cargo run -- --config config.toml --authorize-gmail
```

Windows PowerShell：

```powershell
Copy-Item config.example.toml config.toml
cargo run -- --install-browser
cargo run -- --config config.toml --dry-run
# 只有啟用 Gmail 通知時才需要：
cargo run -- --config config.toml --authorize-gmail
```

確認後正式執行：

```bash
cargo run --release -- --config config.toml
```

主要 CLI 參數：

```text
--config <PATH>    設定檔；未指定時先找執行檔旁的 config.toml
--dry-run          抓取所有啟用遊戲，但不寫入 Google Sheets 或寄信
--show-browser     強制顯示 Chromium 視窗
--install-browser  安裝相符版本的 Chromium，不需要設定檔
--authorize-gmail  完成 Gmail OAuth、儲存 refresh token 並寄測試信
```

程式不會繞過 CAPTCHA。遇到巴哈安全驗證時，請使用 `headless = false` 或 `--show-browser` 自行完成驗證。

## Angular 網站

網站位於 `web/`，使用 Angular 22.0.7、TypeScript 6.0.3 與 Node.js 24。Angular 22 的 Node 24 最低相容版本為 24.15.0。

```bash
cd web
npm ci
npm start
```

測試與 Cloudflare Pages production build：

```bash
cd web
npm run test:ci
npm run build:cloudflare
```

網站設計以 [PlayStation DESIGN.md](https://getdesign.md/playstation/design-md) 的三種高反差 surface、膠囊 CTA、8px 節奏與簡潔動態為參考，再提高本文與焦點的對比度；沒有使用 PlayStation 商標、圖像或專有字型。

說明頁使用一般路由加 URL fragment，例如 `/guide#gmail-api`。這不是 hash-based router；Cloudflare 的 `_redirects` 會把直接開啟 `/guide` 的請求交給 Angular，瀏覽器保留 `#gmail-api` 並捲動到對應章節。

## Cloudflare Pages 與 GitHub Actions

[Web workflow](.github/workflows/deploy-web.yml) 在 pull request 與 `main` 變更時使用 Node.js 24 測試、建置網站。部署預設關閉；完成 Cloudflare 一次性設定後才開啟：

1. 確認 `gamer-catch.pylot.dev` 沒有仍在使用的同名 A、AAAA 或 CNAME；若是舊站記錄，先移除衝突。
2. 建立專用 API token，最小權限只需要 Account 的 Cloudflare Pages Edit。
3. 在 GitHub repository Actions secrets 加入 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`。
4. 在 GitHub Actions variables 設定 `CLOUDFLARE_PAGES_PROJECT=gamer-catch`、`SITE_DOMAIN=gamer-catch.pylot.dev`，最後才將 `CLOUDFLARE_DEPLOY_ENABLED` 改成 `true`。
5. 推送 `main` 或手動執行 Web workflow；workflow 會建立缺少的 project、部署網站、綁定 custom domain，再驗證 HTTPS 與網站識別標記。

DNS 實際由 Cloudflare 管理，不是 GitHub DNS；GitHub 儲存最小權限部署憑證並執行 workflow。Pages 綁定同帳戶 Cloudflare zone 的 custom domain 時會建立所需 DNS 記錄，不需要授予 token DNS Edit。workflow 不會自動刪除衝突記錄。不要把 token 寫進 repository。詳細檢查清單見 [Cloudflare 部署說明](docs/cloudflare-pages.md)。

## 建置發行包

Playwright driver 不是 Rust 執行檔的一部分，因此必須在每個目標平台原生建置。

macOS：

```bash
./scripts/package-macos.sh
```

Windows PowerShell：

```powershell
.\scripts\package-windows.ps1
```

發行 ZIP 只包含安全範例設定、雙擊腳本、Playwright driver、Node 與 `使用說明.txt`；不包含 PDF 或任何真實憑證。Chromium 由第一次設定腳本安裝到使用者快取。

macOS 正式封裝需要 `Developer ID Application` 與 notarization profile。Windows 正式封裝建議使用公開信任的 Authenticode 憑證；目前未設定 Windows 簽章時，只能明確使用 `ALLOW_UNSIGNED_WINDOWS=1` 製作預覽包。簽章不能保證 SmartScreen 永不警告，使用者仍應只從官方 Release 下載並核對 `SHA256SUMS.txt`。

## 開發驗證

```bash
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo test --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cd web && npm ci && npm run test:ci && npm run build:cloudflare
```

CI 也會驗證腳本語法、Windows 排程、發行 ZIP 結構、拒絕提交憑證，並禁止重新加入 PDF 手冊。

排行與人氣是掃描當下的快照。請低頻率執行，不要平行大量抓取，並自行確認及遵守巴哈姆特的服務條款與 robots 規則。
