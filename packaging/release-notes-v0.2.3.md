## 發行重點

v0.2.3 將 GamerCatch 的發行包建立與安全驗證全面移至 Rust。macOS 與 Windows ZIP、Apple 公證回覆、發布前的二次套件檢核及 `SHA256SUMS.txt` 都不再依賴 Python，降低 hosted runner 環境差異造成的發布風險。

網站下載流程也改為直接連到官方 GitHub Release，由瀏覽器原生管理下載進度與安全檢查，不再由 Angular 將大型 ZIP 完整載入記憶體。

## 改善

- 新增獨立的 `gamercatch-release-packager` Rust workspace 工具，統一建立與驗證 macOS／Windows 發行 ZIP。
- ZIP 採固定排序與 metadata，保留 UTF-8 中文檔名及 macOS Unix 執行權限；相同輸入可產生相同位元組。
- GitHub Release 的 SHA-256 清單改由 Rust 串流產生，維持標準 `SHA256SUMS.txt` 格式。
- Release tag 的 Cargo 版本與 Apple `notarytool` JSON 回覆均由型別化 Rust 程式嚴格解析。
- 下載頁直接使用 `releases/latest/download/...` 官方資產連結，仍會依裝置自動選擇 macOS Apple Silicon 或 Windows x64。

## 安全與穩定性

- 建立 ZIP 時拒絕符號連結、特殊檔案、非 UTF-8 名稱、路徑穿越、NTFS ADS、Windows 保留名稱及跨平台檔名碰撞。
- 驗證時逐項串流讀取並核對 CRC、宣告大小及實際大小，限制單檔、總解壓大小與項目數，避免偽造 ZIP metadata 繞過檢核。
- 發行包必須只有一個頂層資料夾、唯一安全的 `config.example.toml`、空白 `credentials/`，且不得包含 `config.toml`、PDF、內嵌秘密或本機建置路徑。
- 保留 macOS Developer ID、hardened runtime、secure timestamp、Team ID 與 Apple 公證 `Accepted`／issues=0 閘門；公證仍針對最終發布的同一份 pending ZIP。
- 保留 Windows CMD UTF-8／CRLF、免提權排程與既有設定檔不覆寫等高風險契約。

## 測試與 CI

- Rust CI 在 Ubuntu、macOS 與 Windows 使用 Rust 1.88 驗證整個 workspace 的 format、check、test 與 Clippy。
- 新增雙平台完整套件 fixture，以及 Unicode、權限、符號連結、目錄 payload、檔案樹衝突、秘密檔案、公證 JSON 與 checksum 回歸測試。
- CI 明確禁止 tracked Python 檔案或 Python 打包命令重新進入發行流程。
- Release publish job 會在 Linux 重新驗證兩平台 artifact，再建立 checksum 與正式 GitHub Release。

## 相容性與注意事項

- 本版未變更 `config.toml` schema；既有 schema version 2 設定不需要重建。
- macOS 正式資產仍使用 Developer ID Application 簽章並送交 Apple 公證；ZIP 本身無法 staple，獨立 `.command` 在部分環境仍可能需要 Finder 核准。
- Windows x64 目前仍未使用 Authenticode 簽章，Microsoft Defender SmartScreen 可能顯示未知發行者；請只從官方 Release 下載並核對 SHA-256。
- 從原始碼建立發行包只需要 Rust 1.88 與平台原生簽章工具，不再需要 Python。

## 升級方式

1. 下載 v0.2.3 對應平台 ZIP，並用 `SHA256SUMS.txt` 核對檔案。
2. 完整解壓縮到新的資料夾，不要覆蓋舊版資料夾。
3. 將既有 `config.toml` 與 `credentials/` 內的 JSON 複製到新資料夾；不要把秘密檔案上傳到 GitHub。
4. 執行第一次設定，再以不寫入模式確認抓取結果。
5. Windows 若有每日排程，請在新版資料夾重新執行排程安裝檔，讓既有工作指向 v0.2.3 路徑。

## 相關連結

- 完整變更紀錄：<https://github.com/Willseed/gamer-catch-rust/compare/v0.2.2...v0.2.3>
- 線上教學：<https://gamer-catch.pylot.dev/guide#quick-start>
- macOS 簽章與公證：<https://github.com/Willseed/gamer-catch-rust/blob/v0.2.3/docs/macos-signing.md>
