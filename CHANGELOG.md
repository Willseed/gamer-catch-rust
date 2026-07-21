# Changelog

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
