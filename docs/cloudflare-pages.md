# Cloudflare Pages 一次性設定

正式網域：`gamer.catch.pylot.dev`

Pages project：`gamer-catch`

GitHub repository：`Willseed/gamer-catch-rust`

## 1. 先確認既有 DNS

`pylot.dev` 使用 Cloudflare nameserver。設定 custom domain 前，先在 Cloudflare DNS 搜尋完整名稱 `gamer.catch.pylot.dev`。若已有 A、AAAA 或 CNAME，不要直接新增第二筆同名記錄；先確認它原本的用途與 Pages project，再移除或改由 Pages custom domain 管理。

網域的 DNS、Universal SSL 與 custom domain 都由 Cloudflare 控制。GitHub 只執行部署 workflow，不能直接替 Cloudflare zone 修改 DNS。

## 2. Pages project 由 workflow 安全建立

第一次啟用部署時，GitHub workflow 會先透過 Cloudflare API 查詢 project：

- Project name：`gamer-catch`
- Production branch：`main`
- Build output：Angular 產物的 `web/dist/cloudflare/browser`

不存在時才建立 Direct Upload project；已存在時不會建立第二個。project 名稱與網域都會先比對固定值，避免部署到錯誤目標。

## 3. 建立最小權限 API token

建立專用 token，不使用 Global API Key：

- Account / Cloudflare Pages / Edit

這個權限已足夠建立 Pages project、部署及綁定同帳戶 Cloudflare zone 的 custom domain；不需要 Zone Read 或 DNS Edit。記下 Cloudflare Account ID。token 只會在建立時顯示一次。

## 4. 放到 GitHub repository settings

GitHub → `Willseed/gamer-catch-rust` → Settings → Secrets and variables → Actions：

Repository secrets：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Repository variable：

- `CLOUDFLARE_PAGES_PROJECT` = `gamer-catch`
- `SITE_DOMAIN` = `gamer.catch.pylot.dev`
- `CLOUDFLARE_DEPLOY_ENABLED` = `true`

在兩個 secrets 都存在之前，variable 必須維持 `false`。workflow 不會在 pull request 使用 Cloudflare secret，也不會部署非 `main` branch。

## 5. 綁定 custom domain

workflow 部署後會查詢 `gamer.catch.pylot.dev`；尚未綁定才呼叫 Pages custom-domain API。Cloudflare 會建立正確 DNS target 並簽發憑證。若步驟 1 的同名舊記錄尚未清除，流程會安全失敗，不會自行刪除或覆寫記錄。

等 Cloudflare Pages 的 custom domain 狀態顯示 Active、Universal SSL 已簽發後再測試：

```bash
curl -fsSIL https://gamer.catch.pylot.dev/
curl -fsSIL https://gamer.catch.pylot.dev/guide#quick-start
```

HTTP 要轉 HTTPS；首頁及 `/guide` 應回 200。URL fragment 不會送到伺服器，所以第二個命令只驗證 `/guide`，實際章節跳轉需在瀏覽器確認。

## 6. 部署與回復

推送 `web/**` 或 deployment workflow 變更到 `main`，會觸發 `.github/workflows/deploy-web.yml`。每次部署前都執行 Angular 測試與 production build。部署後會下載 `/guide` 並確認 GamerCatch Angular 識別標記；日後建立 GitHub Release 前也會檢查線上手冊，避免發布只有下載包、沒有可用說明的版本。

若 token 失效或需暫停部署，先把 `CLOUDFLARE_DEPLOY_ENABLED` 改為 `false`。已上線版本不受影響；workflow 仍會測試與建置，但不呼叫 Cloudflare。

Cloudflare Pages Dashboard 可回復到先前成功 deployment。不要為了回復網站而重寫 DNS 或洩漏 token。
