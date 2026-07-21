# gamer-catch-rust

這是一個 Windows／macOS 工具，使用 Playwright 一次掃描巴哈姆特手機遊戲排行，抓取多個遊戲的「排行」與「人氣」，再分別寫入不同人的 Google Sheets；也可在抓取或寫入異常時，透過 Gmail API 寄出通知信。

預設範例包含三個遊戲位置。每個遊戲都能使用不同的 Google service account JSON、不同試算表、不同工作表、欄位與通知收件人；不需要共用 Google 帳號。

## 完全不懂程式的使用方式

到 [GitHub Releases](https://github.com/Willseed/gamer-catch-rust/releases) 下載符合平台的 ZIP，並完整解壓縮。不要直接在 ZIP 裡執行。repository 目前是 Public，任何人都能下載，因此請勿把填入帳號資訊的設定檔或 JSON 金鑰重新上傳。

目前 `v0.2.0` 只提供 Apple Silicon Mac（arm64）與一般 Intel／AMD Windows（x64）。Intel Mac 與 Windows on ARM 暫不支援。

發行包內含圖文手冊（macOS 21 頁、Windows 22 頁）；原始檔也可直接查看：

- [macOS 零基礎使用手冊](output/pdf/GamerCatch_零基礎使用手冊_macOS.pdf)
- [Windows 零基礎使用手冊](output/pdf/GamerCatch_零基礎使用手冊_Windows.pdf)

### 第一次設定

- macOS：雙擊 `1_首次設定.command`
- Windows：雙擊 `1_首次設定.cmd`

工具會自動準備 Chromium，接著開啟 `config.toml` 與 `credentials` 資料夾。

請完成以下事項：

1. 把每個人的 service account JSON 放進 `credentials` 資料夾。
2. 在 `config.toml` 的每個 `[[games]]` 區塊填入遊戲名稱、試算表、JSON 路徑及欄位。
3. 第二、第三個遊戲要使用時，將該區塊的 `enabled` 改成 `true`。
4. 第一次先保持 `write_to_google_sheets = false`，只驗證抓取結果。
5. 儲存設定檔。

Gmail 異常通知是選用功能。要使用時，請先依下方「Gmail API 異常通知設定」完成 OAuth 設定，再雙擊：

- macOS：`Gmail_首次授權.command`
- Windows：`Gmail_首次授權.cmd`

瀏覽器會要求登入寄件 Gmail。授權成功後，程式會分別寄一封測試信給所有有效收件人；收到測試信後才能依賴自動通知或 Windows 排程。refresh token 只存於目前作業系統帳號的 macOS Keychain 或 Windows Credential Manager，不會建立 token 檔。

### 平常執行

- macOS：雙擊 `2_開始抓取.command`
- Windows：雙擊 `2_開始抓取.cmd`

視窗會保留成功或錯誤訊息，不會執行完立即消失，並將結果存到同一資料夾的 `last-run.log`。確認每個遊戲的排行、人氣都正確後，才將對應區塊的 `write_to_google_sheets` 改成 `true`。成功執行不寄信；`--dry-run` 也不寫入、不寄信。

### Windows 每天上午 9 點自動執行（選用）

先完成手動測試及正式寫入驗證；若啟用 Gmail，也必須先在相同 Windows 帳號完成 Gmail 授權與測試信。之後再雙擊 `3_安裝每天早上9點自動抓取.cmd`。它會呼叫隨附的 `install-windows-task.ps1`，以目前 Windows 帳號和標準權限建立每日 Task；不需要管理員權限、密碼或 UAC，也不會永久修改 PowerShell 執行原則。

- 每天 09:00 是 Windows 本機時間；每個遊戲寫入哪一天仍依自己的 `timezone`。
- 一個 Task 會處理 `config.toml` 內所有 `enabled = true` 的遊戲，以及各自的 service account JSON 和 Google Sheet。
- 目前 Windows 帳號必須保持登入；鎖定畫面可以執行，登出或完全關機時不能在 09:00 執行。錯過後會在再次登入且電腦、網路可用時補跑；睡眠喚醒仍取決於硬體及電源設定。
- 自動執行結果寫入 `last-scheduled-run.log`。排程不會繞過巴哈 CAPTCHA。
- 排程仍遵守 `[bahamut]` 的 `headless`：`false` 會在 09:00 開啟 Chromium；手動驗證完成後可改成 `true` 在背景執行，但遇到安全驗證時仍需改回 `false` 手動處理。
- 排程不會開啟 Gmail 授權頁。若授權被撤銷或過期，請查看 `last-scheduled-run.log`，再以相同 Windows 帳號重新雙擊 `Gmail_首次授權.cmd`。
- Task 會記住資料夾的絕對路徑。移動、改名或升級到新資料夾後，請在新位置再雙擊一次安裝器；重複安裝會更新同一個 Task。
- 若公司政策封鎖 PowerShell 或 Task Scheduler，請聯絡 IT；不要停用安全軟體、改成 `Unrestricted` 或使用管理員權限強行繞過。

## 多遊戲、多帳號設定

範例設定在 [config.example.toml](config.example.toml)。一個 `[[games]]` 區塊代表：

> 一個遊戲 → 一張 Google Sheet → 一份 service account 憑證

主要欄位：

| 欄位 | 用途 |
|---|---|
| `enabled` | 是否抓取這個遊戲 |
| `game_name` | 巴哈卡片上的完整遊戲名稱 |
| `write_to_google_sheets` | 是否真正寫入該遊戲的試算表 |
| `spreadsheet_id` | 可直接貼完整 Google Sheets 網址，或只填試算表 ID |
| `service_account_key_path` | 該使用者自己的 JSON，例如 `credentials/person-2.json` |
| `worksheet_name` | 試算表下方分頁名稱 |
| `timezone` | 尋找今天日期所用時區，預設 `Asia/Taipei` |
| `first_data_row` | 第一筆資料列，預設 2 |
| `date_column` | 日期欄，預設 A |
| `rank_column` | 排行欄，預設 B |
| `popularity_column` | 人氣欄，預設 C |
| `notification_recipients` | 此遊戲專用通知收件人；`[]` 代表改用全域 `default_recipients` |

可以設定一個、三個或更多遊戲，上限 20 個。若同一款遊戲要寫給不同人的試算表，可建立兩個相同 `game_name` 的區塊，各自填不同憑證與試算表。

程式會先驗證所有啟用設定，再開啟巴哈。掃描每個 `page=n` 時只讀取一次頁面，並同時尋找所有尚未找到的遊戲。某個遊戲找不到、排行／人氣解析失敗，或某個人的 Sheets 更新失敗時，其他已找到的遊戲仍會繼續處理，最後再彙整失敗項目。

啟用 Gmail 時，非空白的 `notification_recipients` 會取代該遊戲的全域預設收件人；不是額外加上去。每位收件者會各自收到一封信，看不到其他人的地址，而且同一次執行只會收到一封彙整信，內容只包含他負責的遊戲。瀏覽器、排行頁等影響全部遊戲的全域錯誤，會通知所有啟用遊戲的有效收件人。

### 更換遊戲時要修改與確認什麼

不需要重裝程式。先備份可用的 `config.toml`，再修改要更換的 `[[games]]` 區塊：

1. 先把該區塊的 `write_to_google_sheets` 改成 `false`。
2. 將 `game_name` 改成巴哈排行卡片上的完整名稱；若超出目前搜尋範圍，再逐步提高 `[bahamut]` 的 `end_page`。
3. 換試算表時修改 `spreadsheet_id`、`worksheet_name`、日期列起點與日期／排行／人氣欄位。
4. 換擁有者或 Google 帳號時修改 `service_account_key_path`，並把新試算表分享給該 JSON 的 `client_email`。
5. 確認新試算表已有今天日期，再手動執行一次，核對遊戲名稱、排行、人氣與 `page`；此時應維持不寫入。
6. 測試正確後，只把新遊戲的 `write_to_google_sheets` 改回 `true`，再核對寫入的試算表、分頁、日期列與欄位。不再使用的舊區塊應設為 `enabled = false`。
7. 若已啟用通知，同時核對 `notification_recipients`；留空陣列才會使用全域預設收件人。

Windows 每日 Task 每次都會重新讀取同一份 `config.toml`，因此只換遊戲設定不必重裝排程；只有資料夾路徑改變時才需重裝。

## Google Sheets API 設定

只有 API key 無法寫入私人試算表。本工具使用 Google service account；每個 `[[games]]` 可以指定不同 JSON：

1. 在該使用者的 Google Cloud 專案啟用 Google Sheets API。
2. 建立 service account 並下載 JSON 金鑰。
3. 打開 JSON，複製 `client_email`。
4. 將該遊戲的 Google Sheet 以「編輯者」權限分享給這個 `client_email`。
5. 把 JSON 放入發行資料夾的 `credentials`，並在該遊戲區塊填入路徑。

官方參考：[建立 Google 憑證](https://developers.google.com/workspace/guides/create-credentials)、[Sheets API 使用限制](https://developers.google.com/workspace/sheets/api/limits)。

JSON 內含私鑰，不可提交到 Git、放進公開 ZIP、寄到群組或寫進 log。`credentials/`、`config.toml` 及常見 service account JSON 名稱已加入 `.gitignore`。

## Gmail API 異常通知設定（選用）

Google Sheets 與 Gmail 使用兩套不同認證：Sheets 使用 service account；Gmail 使用寄件者本人同意的 OAuth 2.0「電腦版應用程式」。不要把 Sheets 的 service account JSON 填到 Gmail 欄位，也不要使用 API key。Gmail 只要求最小的 `gmail.send` 權限，不會讀取信箱內容。

### 建立 Gmail OAuth 憑證

1. 以預定的寄件 Gmail 登入 [Google Cloud Console](https://console.cloud.google.com/)，建立或選擇專案。
2. 到「API 和服務」→「程式庫」，搜尋並啟用 Gmail API。
3. 到「Google Auth Platform」設定應用程式名稱、支援信箱與 Audience：
   - 有 Google Workspace 組織且只供同組織使用時，可選 `Internal`。
   - 一般個人 Gmail 選 `External`；仍在 `Testing` 時，務必把 `sender_email` 加入 Test users。
4. 在 Data Access 加入 `https://www.googleapis.com/auth/gmail.send`，不要加入可讀信件或完整信箱的更大權限。
5. 到 Clients 建立 OAuth client，Application type 必須選 `Desktop app`，下載 JSON。
6. 將檔案重新命名為 `gmail-oauth-client.json`，放入發行資料夾的 `credentials`。

官方參考：[建立 OAuth 憑證](https://developers.google.com/workspace/guides/create-credentials)、[Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Gmail API 寄信流程](https://developers.google.com/workspace/gmail/api/guides/sending)。

`gmail.send` 是 sensitive scope。External 專案若保持 `Testing`，這類授權及 refresh token 通常會在 7 天後失效，不適合無人值守的每日排程。長期使用前，請依帳號情況改用組織內部 `Internal`，或將 External 專案切換為 `In production` 並完成 Google 要求的適用設定／驗證。個人少量使用可能符合免驗證條件，但仍可能看到未驗證應用程式警告與人數限制；不要把警告描述成錯誤，也不要要求他人繞過不明應用程式的警告。參考：[Audience 與 7 天期限](https://support.google.com/cloud/answer/15549945)、[何時不需要驗證](https://support.google.com/cloud/answer/13464323)。

### 填寫收件人與首次授權

```toml
[gmail_notifications]
enabled = true
sender_email = "alerts@gmail.com"
default_recipients = ["owner@example.com", "backup@example.com"]
oauth_client_secret_path = "credentials/gmail-oauth-client.json"
subject_prefix = "[GamerCatch]"

[[games]]
# 其餘遊戲與 Sheets 欄位省略
notification_recipients = []

[[games]]
# 非空白時只通知這些人，不再使用 default_recipients
notification_recipients = ["person-2@example.com"]
```

設定規則：

- 一份 `config.toml` 只使用一個 `sender_email` 寄件 Gmail，但可設定多個遊戲與多位收件人；若需要不同寄件 Gmail，請使用彼此獨立的設定檔與發行資料夾。
- `sender_email` 必須和瀏覽器授權時登入的 Gmail 相同；若日後更換寄件帳號，必須重新授權。
- `default_recipients` 即使只有一人也要寫成 `["地址"]` 的陣列格式。
- 每個啟用遊戲最後都必須有收件人。`notification_recipients = []` 才會退回使用 `default_recipients`；非空白時會取代預設值。
- 最多支援 50 個不同收件人。重複地址會忽略大小寫後去重。
- `subject_prefix` 通常保持預設；不可含換行或控制字元，最多 60 個字。

儲存後雙擊 `Gmail_首次授權.command`（macOS）或 `Gmail_首次授權.cmd`（Windows）。程式使用 PKCE，僅在 `127.0.0.1` 的隨機本機 port 等待 Google 回傳結果，五分鐘後即逾時；它不會開放區域網路連線。請保持黑色視窗開啟、登入 `sender_email` 並同意 `gmail.send`。完成後，每位有效收件人會各收到一封測試信，結果也會寫入 `last-gmail-authorization.log`。

refresh token 只存於目前登入帳號的 macOS Keychain 或 Windows Credential Manager，不會寫入 `config.toml`、JSON 或獨立 token 檔。同一份 ZIP／設定交給另一位 Windows 或 macOS 登入使用者時，不會帶走授權；每個作業系統帳號都要各自執行一次首次授權，Windows 排程也必須由安裝該 Task 的同一帳號使用。換電腦、換作業系統使用者、變更寄件帳號、撤銷 Google 權限或授權過期時，都要重新雙擊首次授權腳本。正常抓取與 Windows 排程只讀取既有安全憑證，絕不在無人值守時彈出登入頁。

### 什麼時候會寄信

- 會寄：Chromium／Playwright、網路或排行頁載入、HTTP、巴哈安全驗證、DOM 或排行／人氣解析失敗；找不到已啟用遊戲；已開啟 Sheets 寫入但找不到今天日期或更新失敗。
- 不會寄：全部成功、`--dry-run`、刻意設定 `write_to_google_sheets = false`。
- 每位收件者在同一次執行最多收到一封彙整信。每封分開寄送，收件者看不到其他人的地址。
- `config.toml` 無法讀取或解析、程式根本沒有啟動、整台電腦斷網，或 Gmail 本身無法送信時，通知可能無法寄出，仍須查看 `last-run.log` 或 `last-scheduled-run.log`。
- Gmail 寄送失敗不會蓋掉原本的抓取／寫入錯誤；終端機與 log 會同時保留原始錯誤及通知失敗原因。

OAuth JSON 含有 client secret，仍不可提交到 Git、放進公開 ZIP、寄到群組或附在問題回報。首次授權 log 可能含短效授權網址，分享前也應先檢查。refresh token 雖不落地成檔案，仍應保護作業系統登入帳號與 Keychain／Credential Manager。

## 工作表日期規則

程式以各遊戲的 `timezone` 找到今天日期，並寫入同一列的排行與人氣欄位：

- 真正的 Sheets 日期儲存格即使顯示 `M/D`，仍會以 serial date 判斷完整年份。
- 純文字日期只接受含年份的 `YYYY-MM-DD`、`YYYY/M/D` 或 `M/D/YYYY`。
- 找不到今天時安全不寫入、不會自動新增資料列，並將該遊戲回報為未完成。
- 同一天出現兩列時拒絕寫入。
- 讀取日期到寫入之間，請勿排序、插入或刪除工作表列。

## 從原始碼執行

需求：Rust 1.88 以上、macOS 14+ 或 Windows 11／Windows Server 2019+。作業系統版本依 [Playwright system requirements](https://playwright.dev/docs/intro#system-requirements)。

macOS／Linux shell：

```bash
cd /path/to/gamer-catch-rust
cp config.example.toml config.toml
cargo run -- --install-browser
cargo run -- --config config.toml --dry-run
# 只有啟用 Gmail 通知時才需要執行：
cargo run -- --config config.toml --authorize-gmail
```

Windows PowerShell：

```powershell
cd C:\path\to\gamer-catch-rust
Copy-Item config.example.toml config.toml
cargo run -- --install-browser
cargo run -- --config config.toml --dry-run
# 只有啟用 Gmail 通知時才需要執行：
cargo run -- --config config.toml --authorize-gmail
```

確認後正式執行：

```bash
cargo run --release -- --config config.toml
```

舊版單遊戲的 `[game]`／`[google_sheets]` 設定仍可讀取，且會保留原本 `enabled=false` 不寫入的安全語意；啟動時會提示改用新版 `[[games]]`。

## CLI 參數

```text
--config <PATH>    設定檔；未指定時先找執行檔旁的 config.toml
--dry-run          抓取所有啟用遊戲，但不寫入任何 Google Sheets
--show-browser     強制顯示 Chromium 視窗
--install-browser  安裝相符版本的 Chromium，不需要設定檔
--authorize-gmail  互動完成 Gmail OAuth，安全儲存 refresh token 並寄測試信
```

若巴哈顯示安全驗證頁，程式會等待排行卡片，逾時後停止。可使用 `--show-browser` 由使用者自行完成網站驗證；程式不會繞過或自動解 CAPTCHA。範例的 `headless=false` 會顯示瀏覽器，對巴哈通常較可靠。

## 建置可雙擊的發行資料夾

Playwright driver 不是 Rust 執行檔的一部分，因此請在每個目標平台原生建置，不要混用 Windows/macOS 或 x64/arm64 driver。

若有修改手冊來源，先重新產生兩份 PDF：

```bash
python3 scripts/generate-manual.py
```

macOS：

```bash
./scripts/package-macos.sh
```

輸出：`dist/GamerCatch-macOS-arm64.zip` 或 `-x64.zip`，解壓縮後包含首次設定、開始抓取與 Gmail 首次授權三個 `.command` 腳本。

Windows PowerShell：

```powershell
.\scripts\package-windows.ps1
```

輸出：`dist\GamerCatch-Windows-x64.zip` 或 `-arm64.zip`，包含四個 `.cmd` 腳本；其中 `Gmail_首次授權.cmd` 處理 OAuth，`3_安裝每天早上9點自動抓取.cmd` 會呼叫內附的 `install-windows-task.ps1` 安裝每日排程。

發行資料夾包含安全範例 `config.toml`、平台 PDF 手冊、雙擊啟動器、Playwright driver 與 Node，但絕不包含任何真實 JSON 私鑰、OAuth client secret 或 refresh token。Chromium 由雙擊啟動器在第一次使用時安裝到該電腦的使用者快取。

Playwright 0.14.1 的上游程式碼保留在 `vendor/playwright-rs`，只修補兩項發行需求：讓明確指定的隨附 driver 優先於使用者舊快取，以及驗證 playwright-core 的 SHA-512 與 Node.js 官方 SHA-256。上游 Apache-2.0 授權與 notices 均保留。

### 發行簽章

macOS 封裝腳本會自動尋找唯一的 `Developer ID Application`，並以 hardened runtime 與 secure timestamp 簽署 Rust 主程式和隨附 Node。若 Keychain 有多張憑證，可指定：

```bash
MACOS_SIGN_IDENTITY="憑證 SHA-1 或完整名稱" ./scripts/package-macos.sh
```

Apple notarization 另外需要 `notarytool` Keychain profile：

```bash
xcrun notarytool store-credentials "gamercatch-notary" \
  --apple-id "你的 Apple ID" --team-id "你的 TEAM ID"

MACOS_NOTARY_PROFILE="gamercatch-notary" ./scripts/package-macos.sh
```

密碼請在 `notarytool` 的安全提示中輸入，不要寫入腳本或 Git。若找不到 Developer ID 或 notarization profile，封裝腳本會停止，避免不小心把未簽版當正式版。只有明確製作預覽版時，才可用 `ALLOW_UNSIGNED_MACOS=1` 或 `ALLOW_UNNOTARIZED_MACOS=1` 放行。

腳本式 `.command` 仍可能在第一次下載開啟時要求使用者確認；Developer ID 與 notarization 能驗證隨附執行碼的發布者與完整性，但不能保證所有安全產品永不警告。[Apple Developer ID](https://developer.apple.com/support/developer-id/)、[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。

Windows 若在台灣直接散布，建議向 Microsoft Trusted Root 鏈上的 CA 申請公開信任 OV／Non-EV Authenticode 憑證，私鑰放在 CA 提供的 USB token 或 cloud HSM，並使用 SHA-256 與 RFC 3161 timestamp。EV 已不再自動取得 SmartScreen 信任；新檔案即使正確簽章，初期仍可能顯示 reputation 警告。[Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)、[SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

Windows 封裝腳本支援憑證存放區：

```powershell
$env:WINDOWS_SIGN_CERT_SHA1 = "憑證 thumbprint"
$env:WINDOWS_TIMESTAMP_URL = "CA 提供的 RFC 3161 URL"
.\scripts\package-windows.ps1
```

未設定 Windows 簽章時封裝會停止。只有明確製作未簽預覽版時，才可先設定 `$env:ALLOW_UNSIGNED_WINDOWS = "1"`；GitHub Release 會清楚標示預覽版的簽章狀態。

目前 `v0.2.0` Release 是未簽章預覽版：本機 Keychain 尚未提供可用的 Developer ID Application 私鑰，Windows 也尚未申請 Authenticode 憑證。請只從本 repository 的 Release 下載並核對 `SHA256SUMS.txt`，不要關閉作業系統安全功能。

## 開發驗證

```bash
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo test --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
```

## 常見錯誤

- 找不到發行檔：請先完整解壓縮整個資料夾，不要直接在 ZIP 內雙擊。
- `Chromium ... not found`：重新雙擊首次設定或開始抓取，啟動器會自動補裝。
- 找不到遊戲：提高 `end_page`，並確認 `game_name` 與巴哈顯示完全相同。
- 找不到排行卡片：可能是安全驗證、網路錯誤或巴哈改版；保持 `headless=false` 重試。
- service account JSON 錯誤：確認該遊戲指向自己的 JSON，且檔案位於設定的路徑。
- Google 403：通常是 API 未啟用，或該 Sheet 未分享給對應 JSON 的 `client_email`。
- Gmail OAuth JSON 錯誤或 `redirect_uri_mismatch`：確認下載的是 OAuth client 的「電腦版應用程式」JSON，不是 Web client、API key 或 service account。
- Gmail 顯示 `access_denied`：External Testing 專案要把寄件帳號加入 Test users；公司或學校帳號也可能被管理政策封鎖，請聯絡管理員。
- Gmail API 403：確認 Gmail API 已啟用，且授權只使用 `gmail.send`。若 scope 曾變更，請撤銷舊授權後重新雙擊 Gmail 首次授權腳本。
- 找不到 Gmail 授權或權杖更新失敗：以相同作業系統帳號重新雙擊 Gmail 首次授權腳本；External Testing 的授權通常七天失效。
- Gmail 本機回呼逾時：保持黑色視窗開啟，在五分鐘內完成瀏覽器授權；若公司防火牆封鎖 `127.0.0.1` 本機連線，請聯絡 IT。
- 收不到異常信：成功、dry-run 與刻意關閉 Sheets 寫入都不寄；其他情況先查看執行 log 是否同時顯示 Gmail 寄送失敗。
- 輸出欄位重疊：同一試算表、同一工作表不能讓兩個遊戲寫入相同排行／人氣欄。
- Windows 排程安裝後出現亂碼或 `is not recognized`：若亂碼前已看到 `Scheduled task installed or updated.`，v0.1.1 的 Windows 工作排程通常已建立，亂碼只影響畫面。請完整解壓縮 v0.2.0 或更新版本，將原本的 `config.toml` 與 `credentials` 安全複製到新版資料夾，再於新版資料夾雙擊 `3_安裝每天早上9點自動抓取.cmd`；不必先刪除原 Task，安裝器會直接更新工作與程式路徑。若啟用 Gmail，還要重新確認測試信。
- Windows 排程未執行：確認目前帳號仍登入、Task 未停用，以及電腦、網路與喚醒設定可用；再查看 `last-scheduled-run.log`。

排行與人氣是掃描當下的快照。請低頻率執行、不要平行大量抓取，並自行確認及遵守巴哈姆特的服務條款與 robots 規則。
