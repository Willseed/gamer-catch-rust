## 發行重點

修正 Windows 排程已成功安裝後，第二行繁體中文被 `cmd.exe` 誤判為指令並顯示亂碼的問題。v0.1.1 使用者不必刪除既有 Task；下載本版並在新的解壓縮資料夾重新雙擊第 3 個安裝檔，即會更新同一個排程。

## 修正

- `3_安裝每天早上9點自動抓取.cmd` 改用不含括號區塊的成功／失敗流程，避免多位元 UTF-8 中文被切到字元中間。
- `2_開始抓取.cmd` 同步移除相同型態的中文括號區塊，預防手動執行入口發生同類問題。
- 保留真實結束碼；成功、失敗及測試用不暫停流程都會正確結束。

## 驗證

- Windows CI 會在含空白及特殊字元的路徑中，透過 `cmd.exe` 真正執行第 2 個抓取檔與第 3 個排程安裝檔。
- CI 以嚴格 UTF-8 解碼輸出，確認完整的成功／失敗繁體中文存在，且不含取代字元或 `is not recognized as an internal or external command`。
- CI 仍會建立、重複更新、實際啟動、檢查並清理測試 Task，確保免管理員權限與多人 Windows 帳號隔離行為不變。
- Windows ZIP 驗證會確認三支 CMD 都是 UTF-8 無 BOM、CRLF，並拒絕缺少修正版流程或重新出現括號式控制流程的檔案。

## 文件

- Windows 零基礎手冊、README 與文字說明新增 v0.1.1 亂碼情況的處理方式。
- 兩平台手冊均更新為 v0.1.2；macOS 功能沒有改變。

## 升級方式

1. 下載並完整解壓縮 v0.1.2 Windows ZIP。
2. 將原本的 `config.toml` 與 `credentials` 資料夾安全複製到新版資料夾。
3. 在新版資料夾重新雙擊 `3_安裝每天早上9點自動抓取.cmd`。同一個 Windows 帳號會更新原本的 Task，不會建立重複工作。

如果 v0.1.1 畫面已先顯示 `Scheduled task installed or updated.`，代表 Task 通常已成功建立；後面的亂碼只影響 CMD 顯示。但新版資料夾路徑不同，仍應重新安裝一次，讓 Task 指向 v0.1.2。

## 注意事項

- 本版仍是未完成 macOS Developer ID／公證及 Windows Authenticode 簽章的預覽版。請只從本 repository 的 Release 下載並核對 `SHA256SUMS.txt`。
- 不要為了處理 SmartScreen 或公司政策而停用安全軟體、放寬 PowerShell 全域執行原則或改用管理員權限強行繞過。

## 相關連結

- 完整變更紀錄：https://github.com/Willseed/gamer-catch-rust/compare/v0.1.1...v0.1.2
