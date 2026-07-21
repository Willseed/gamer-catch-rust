# GamerCatch Web

`gamer.catch.pylot.dev` 的 Angular 22 靜態網站，包含：

- 多遊戲、多 Google Sheets、多人帳號與 Gmail 收件人的 `config.toml` 產生器
- macOS／Windows 下載入口
- 支援 `/guide#章節` 深連結的繁中線上教學

表單資料只存在瀏覽器記憶體，不會送出或保存；網站也不接受任何 Google JSON 憑證。

## 本機開發

需要 Node.js 24.15.0 以上、低於 25，以及 npm 11。

```bash
npm ci
npm start
```

開啟 `http://localhost:4200/`。

## 測試與建置

```bash
npm run test:ci
npm run build:cloudflare
```

Cloudflare Pages 產物位於 `dist/cloudflare/browser`。部署設定與一次性 DNS 檢查見 repository 根目錄的 `docs/cloudflare-pages.md`。
