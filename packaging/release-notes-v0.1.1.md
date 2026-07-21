## 發行重點

Windows 版新增真正可雙擊的一鍵排程安裝器，可用目前 Windows 帳號的標準權限建立每天上午 09:00 自動抓取工作，不需要系統管理員權限或密碼。本版也在兩平台手冊加入完整的「更換遊戲」檢查流程。

## 新增

- Windows 解壓縮後可雙擊 `3_安裝每天早上9點自動抓取.cmd`，由內附的 `install-windows-task.ps1` 安裝 Task Scheduler 工作。
- Task 使用目前 Windows 使用者、`Interactive` 登入型態與 `Limited` 執行層級；工作名稱包含使用者 SID，同一台電腦的不同帳號不會互相覆蓋。
- 每天 Windows 本機時間 09:00 執行，同一個 Task 會處理 `config.toml` 內所有已啟用遊戲及各自的 service account JSON、Google Sheet。
- 支援錯過時間後補跑、允許電池供電、嘗試從睡眠喚醒及避免同一 Task 重複執行。
- 自動執行結果獨立寫入 `last-scheduled-run.log`，不覆蓋手動執行的 `last-run.log`。

## 文件

- macOS 手冊更新為 18 頁，新增「更換遊戲時要修改與確認什麼」專章。
- Windows 手冊更新為 19 頁，新增每日 09:00 排程專章及「更換遊戲」專章。
- README 與文字說明補充排程限制、資料夾搬移／升級處理、多人帳號及更換遊戲的安全驗證順序。

## 驗證

- CI 以 Windows PowerShell 5.1 解析所有 PowerShell 腳本，並建立、實際啟動、檢查及清理測試 Task。
- Windows ZIP 驗證排程入口、PowerShell 內容、標準權限標記及禁止提升權限標記。
- macOS／Windows PDF 重新產生並逐頁檢查版面、文字與頁數。
- 發行包仍會驗證必要檔案、空白 credentials、執行檔格式及 SHA-256 checksum。

## 注意事項

- 免密碼的排程要求目前 Windows 帳號保持登入；鎖定畫面可以執行，登出或完全關機時不能在 09:00 執行。
- 睡眠喚醒取決於硬體與 Windows 電源設定；錯過時間後會在再次登入且電腦與網路可用時補跑。
- 排程不會繞過巴哈安全驗證或 CAPTCHA。
- Task 會記住解壓縮資料夾的完整路徑。移動、改名或升級到新資料夾後，必須在新位置重新執行安裝器。
- 本版仍是未完成 macOS Developer ID／公證及 Windows Authenticode 簽章的預覽版。請只從本 repository 的 Release 下載並核對 `SHA256SUMS.txt`。

## 相關連結

- 完整變更紀錄：https://github.com/Willseed/gamer-catch-rust/compare/v0.1.0...v0.1.1
- Microsoft Task Scheduler 安全內容：https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks
- Microsoft ScheduledTasks：https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask
