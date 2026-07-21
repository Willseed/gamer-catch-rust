use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{SecondsFormat, Utc};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use keyring_core::{Entry, api::CredentialStoreApi};
use lettre::{
    Message,
    message::{Mailbox, header::ContentType},
};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet,
    PkceCodeChallenge, RedirectUrl, RefreshToken, Scope, TokenResponse, TokenUrl,
};
use reqwest::{Client as HttpClient, StatusCode, header::RETRY_AFTER, redirect::Policy};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{sleep, timeout};
use url::Url;

use crate::config::{AppConfig, GameConfig, GmailNotificationsConfig};

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/";
const GMAIL_SEND_SCOPE: &str = "https://www.googleapis.com/auth/gmail.send";
const KEYRING_SERVICE: &str = "com.willseed.gamercatch.gmail-oauth";
const CALLBACK_PATH: &str = "/oauth/callback";
const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(300);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_CALLBACK_BYTES: usize = 16 * 1024;
const MAX_CALLBACK_ATTEMPTS: usize = 8;
const MAX_ERROR_DETAIL_CHARS: usize = 4_000;
const MAX_RESPONSE_DETAIL_CHARS: usize = 2_000;
const SEND_ATTEMPTS: usize = 3;

type GoogleOAuthClient =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureRecord {
    pub game_name: Option<String>,
    pub stage: String,
    pub detail: String,
    recipients: Vec<String>,
}

#[derive(Debug)]
struct NotificationPlan {
    recipient: String,
    failures: Vec<FailureRecord>,
}

#[derive(Debug, Deserialize)]
struct OAuthClientFile {
    installed: InstalledOAuthClient,
}

#[derive(Debug, Deserialize)]
struct InstalledOAuthClient {
    client_id: String,
    client_secret: String,
}

#[derive(Debug)]
struct GmailRequestError {
    retryable: bool,
    retry_after: Option<Duration>,
    message: String,
}

#[derive(Debug)]
struct AuthorizedTokens {
    client_id: String,
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, PartialEq, Eq)]
enum ParsedCallback {
    Code(String),
    Denied(String),
}

impl FailureRecord {
    pub fn for_game(
        config: &AppConfig,
        game: &GameConfig,
        stage: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            game_name: Some(game.game_name.clone()),
            stage: stage.into(),
            detail: truncate_chars(&detail.into(), MAX_ERROR_DETAIL_CHARS),
            recipients: recipients_for_game(config, game),
        }
    }

    pub fn global(config: &AppConfig, stage: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            game_name: None,
            stage: stage.into(),
            detail: truncate_chars(&detail.into(), MAX_ERROR_DETAIL_CHARS),
            recipients: all_notification_recipients(config),
        }
    }

    pub fn summary(&self) -> String {
        match &self.game_name {
            Some(game_name) => format!("{game_name}：{}", self.stage),
            None => self.stage.clone(),
        }
    }
}

pub async fn authorize_and_send_test(config: &AppConfig) -> Result<usize> {
    ensure!(
        config.gmail_notifications.enabled,
        "Gmail 通知尚未啟用；請先完成 [gmail_notifications] 設定並將 enabled 改成 true"
    );
    let recipients = all_notification_recipients(config);
    ensure!(!recipients.is_empty(), "沒有可寄送測試信的收件人");

    let tokens = authorize_tokens(&config.gmail_notifications).await?;
    let subject = format!(
        "{} Gmail 異常通知測試成功",
        config.gmail_notifications.subject_prefix
    );
    let body = format!(
        "GamerCatch Gmail API 授權與測試信已成功。\n\n\
         時間（UTC）：{}\n\
         寄件帳號：{}\n\
         權限：gmail.send\n\n\
         之後只有正式執行發生異常時才會寄信；成功執行與 dry-run 都不會寄信。\n",
        timestamp(),
        config.gmail_notifications.sender_email
    );
    let sent = send_to_recipients(
        &tokens.access_token,
        &config.gmail_notifications.sender_email,
        &recipients,
        &subject,
        &body,
    )
    .await?;
    save_refresh_token(
        &config.gmail_notifications,
        &tokens.client_id,
        &tokens.refresh_token,
    )?;
    println!("Gmail 授權完成，測試信已分別寄給 {sent} 位收件人。");
    Ok(sent)
}

pub async fn send_failure_notifications(
    config: &AppConfig,
    config_path: &Path,
    failures: &[FailureRecord],
) -> Result<usize> {
    ensure!(config.gmail_notifications.enabled, "Gmail 通知尚未啟用");
    let plans = plan_notifications(failures);
    if plans.is_empty() {
        return Ok(0);
    }

    let access_token = refresh_access_token(&config.gmail_notifications).await?;
    let http_client = oauth_http_client()?;
    let mut sent = 0usize;
    let mut delivery_errors = Vec::new();
    for plan in plans {
        let subject = format!(
            "{} 巴哈排行抓取異常（{} 項）",
            config.gmail_notifications.subject_prefix,
            plan.failures.len()
        );
        let body = failure_body(config_path, &plan.failures);
        match send_one_message(
            &http_client,
            &access_token,
            &config.gmail_notifications.sender_email,
            &plan.recipient,
            &subject,
            &body,
        )
        .await
        {
            Ok(()) => sent += 1,
            Err(error) => delivery_errors.push(format!("{}：{error:#}", plan.recipient)),
        }
    }

    if !delivery_errors.is_empty() {
        bail!(
            "Gmail 通知有 {} 位收件人寄送失敗：{}",
            delivery_errors.len(),
            delivery_errors.join("；")
        );
    }
    println!("Gmail 異常通知已分別寄給 {sent} 位收件人。");
    Ok(sent)
}

fn recipients_for_game(config: &AppConfig, game: &GameConfig) -> Vec<String> {
    let recipients = if game.notification_recipients.is_empty() {
        &config.gmail_notifications.default_recipients
    } else {
        &game.notification_recipients
    };
    unique_recipients(recipients)
}

fn all_notification_recipients(config: &AppConfig) -> Vec<String> {
    let mut recipients = Vec::new();
    for game in config.active_games() {
        recipients.extend(recipients_for_game(config, game));
    }
    unique_recipients(recipients)
}

fn unique_recipients<I, S>(recipients: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut unique = BTreeMap::new();
    for recipient in recipients {
        let recipient = recipient.as_ref();
        unique
            .entry(recipient.to_ascii_lowercase())
            .or_insert_with(|| recipient.to_owned());
    }
    unique.into_values().collect()
}

fn plan_notifications(failures: &[FailureRecord]) -> Vec<NotificationPlan> {
    let mut grouped: BTreeMap<String, (String, Vec<FailureRecord>)> = BTreeMap::new();
    for failure in failures {
        for recipient in &failure.recipients {
            let entry = grouped
                .entry(recipient.to_ascii_lowercase())
                .or_insert_with(|| (recipient.clone(), Vec::new()));
            entry.1.push(failure.clone());
        }
    }
    grouped
        .into_values()
        .map(|(recipient, failures)| NotificationPlan {
            recipient,
            failures,
        })
        .collect()
}

fn failure_body(config_path: &Path, failures: &[FailureRecord]) -> String {
    let config_name = config_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.toml");
    let mut body = format!(
        "GamerCatch 本次執行有 {} 個項目未完成。\n\n\
         時間（UTC）：{}\n\
         程式版本：{}\n\
         平台：{} {}\n\
         設定檔：{}\n\n",
        failures.len(),
        timestamp(),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        config_name
    );
    for (index, failure) in failures.iter().enumerate() {
        let target = failure.game_name.as_deref().unwrap_or("全部遊戲");
        body.push_str(&format!(
            "{}. {}｜{}\n{}\n\n",
            index + 1,
            target,
            failure.stage,
            failure.detail
        ));
    }
    body.push_str(
        "請先查看 last-run.log 或 last-scheduled-run.log。若授權失效，請重新雙擊 Gmail 首次授權腳本。\n",
    );
    body
}

async fn authorize_tokens(config: &GmailNotificationsConfig) -> Result<AuthorizedTokens> {
    ensure_supported_token_store()?;
    let secret = read_oauth_client(config)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("無法建立 Gmail OAuth 本機回呼連線；請檢查防火牆設定")?;
    let port = listener.local_addr()?.port();
    let redirect_url = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let client = oauth_client(&secret, Some(&redirect_url))?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (authorization_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(GMAIL_SEND_SCOPE.to_owned()))
        .add_extra_param("access_type", "offline")
        .add_extra_param("login_hint", config.sender_email.trim())
        .add_extra_param("prompt", "consent select_account")
        .set_pkce_challenge(pkce_challenge)
        .url();

    println!("即將開啟 Google 授權頁；請登入設定的寄件 Gmail 並同意 gmail.send 權限。");
    println!("若瀏覽器沒有自動開啟，請複製此網址：\n{authorization_url}\n");
    if let Err(error) = open_browser(authorization_url.as_str()) {
        eprintln!("無法自動開啟瀏覽器：{error}");
    }
    let code = receive_authorization_code(listener, csrf_token.secret()).await?;
    let http_client = oauth_http_client()?;
    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .context("Google OAuth 授權碼交換失敗；請確認 OAuth 用戶端是「電腦版應用程式」")?;
    let refresh_token = token
        .refresh_token()
        .context("Google 沒有回傳 refresh token；請到 Google 帳號撤銷本工具權限後重新授權")?;
    Ok(AuthorizedTokens {
        client_id: secret.client_id,
        access_token: token.access_token().secret().to_owned(),
        refresh_token: refresh_token.secret().to_owned(),
    })
}

async fn refresh_access_token(config: &GmailNotificationsConfig) -> Result<String> {
    ensure_supported_token_store()?;
    let secret = read_oauth_client(config)?;
    let refresh_secret = load_refresh_token(config, &secret.client_id)?;
    let refresh_token = RefreshToken::new(refresh_secret);
    let client = oauth_client(&secret, None)?;
    let http_client = oauth_http_client()?;
    let token = client
        .exchange_refresh_token(&refresh_token)
        .request_async(&http_client)
        .await
        .context(
            "Gmail OAuth 權杖更新失敗；授權可能已撤銷、過期或寄件帳號密碼已變更，請重新執行 Gmail 首次授權",
        )?;
    if let Some(rotated_refresh_token) = token.refresh_token() {
        save_refresh_token(config, &secret.client_id, rotated_refresh_token.secret())?;
    }
    Ok(token.access_token().secret().to_owned())
}

fn read_oauth_client(config: &GmailNotificationsConfig) -> Result<InstalledOAuthClient> {
    let path = &config.oauth_client_secret_path;
    let contents = fs::read_to_string(path)
        .with_context(|| format!("無法讀取 Gmail OAuth JSON：{}", path.display()))?;
    let file: OAuthClientFile = serde_json::from_str(&contents).with_context(|| {
        format!(
            "Gmail OAuth JSON 格式錯誤：{}；必須下載「電腦版應用程式」OAuth 用戶端 JSON，不能使用 API key 或 service account JSON",
            path.display()
        )
    })?;
    ensure!(
        file.installed
            .client_id
            .ends_with(".apps.googleusercontent.com"),
        "Gmail OAuth JSON 的 client_id 無效"
    );
    ensure!(
        !file.installed.client_secret.trim().is_empty(),
        "Gmail OAuth JSON 缺少 client_secret"
    );
    Ok(file.installed)
}

fn oauth_client(
    secret: &InstalledOAuthClient,
    redirect_url: Option<&str>,
) -> Result<GoogleOAuthClient> {
    let client = BasicClient::new(ClientId::new(secret.client_id.clone()))
        .set_client_secret(ClientSecret::new(secret.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(GOOGLE_AUTH_URL.to_owned())?)
        .set_token_uri(TokenUrl::new(GOOGLE_TOKEN_URL.to_owned())?);
    match redirect_url {
        Some(url) => Ok(client.set_redirect_uri(RedirectUrl::new(url.to_owned())?)),
        None => Ok(client),
    }
}

fn oauth_http_client() -> Result<HttpClient> {
    http_client_with_timeouts(HTTP_CONNECT_TIMEOUT, HTTP_REQUEST_TIMEOUT)
}

fn http_client_with_timeouts(
    connect_timeout: Duration,
    request_timeout: Duration,
) -> Result<HttpClient> {
    HttpClient::builder()
        .redirect(Policy::none())
        .connect_timeout(connect_timeout)
        .timeout(request_timeout)
        .build()
        .context("建立 Google OAuth HTTPS client 失敗")
}

#[cfg(target_os = "macos")]
fn keyring_entry(config: &GmailNotificationsConfig, client_id: &str) -> Result<Entry> {
    let store =
        apple_native_keyring_store::keychain::Store::new().context("無法開啟 macOS Keychain")?;
    store
        .build(KEYRING_SERVICE, &keyring_username(config, client_id), None)
        .context("無法建立 macOS Keychain 憑證項目")
}

#[cfg(target_os = "windows")]
fn keyring_entry(config: &GmailNotificationsConfig, client_id: &str) -> Result<Entry> {
    let store = windows_native_keyring_store::Store::new()
        .context("無法開啟 Windows Credential Manager")?;
    store
        .build(KEYRING_SERVICE, &keyring_username(config, client_id), None)
        .context("無法建立 Windows Credential Manager 憑證項目")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_refresh_token(
    config: &GmailNotificationsConfig,
    client_id: &str,
    refresh_token: &str,
) -> Result<()> {
    keyring_entry(config, client_id)?
        .set_password(refresh_token)
        .context("無法把 Gmail refresh token 存入作業系統安全憑證儲存區")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_refresh_token(config: &GmailNotificationsConfig, client_id: &str) -> Result<String> {
    keyring_entry(config, client_id)?
        .get_password()
        .context("找不到 Gmail 授權；正常執行與排程不會開啟瀏覽器，請先雙擊 Gmail 首次授權腳本")
}

fn keyring_username(config: &GmailNotificationsConfig, client_id: &str) -> String {
    let identity = format!(
        "{}\0{}",
        config.sender_email.trim().to_ascii_lowercase(),
        client_id
    );
    let digest = Sha256::digest(identity.as_bytes());
    format!("gmail-oauth-{}", URL_SAFE_NO_PAD.encode(digest))
}

fn ensure_supported_token_store() -> Result<()> {
    ensure!(
        cfg!(any(target_os = "macos", target_os = "windows")),
        "Gmail 安全授權儲存目前只支援 macOS 與 Windows 發行版"
    );
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_refresh_token(
    _config: &GmailNotificationsConfig,
    _client_id: &str,
    _refresh_token: &str,
) -> Result<()> {
    bail!("Gmail 安全授權儲存目前只支援 macOS 與 Windows 發行版")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_refresh_token(_config: &GmailNotificationsConfig, _client_id: &str) -> Result<String> {
    bail!("Gmail 安全授權儲存目前只支援 macOS 與 Windows 發行版")
}

async fn receive_authorization_code(listener: TcpListener, expected_state: &str) -> Result<String> {
    timeout(
        AUTHORIZATION_TIMEOUT,
        receive_valid_authorization_code(&listener, expected_state),
    )
    .await
    .context("等待 Google OAuth 授權逾時（5 分鐘）")?
}

async fn receive_valid_authorization_code(
    listener: &TcpListener,
    expected_state: &str,
) -> Result<String> {
    let mut last_error = None;
    for _ in 0..MAX_CALLBACK_ATTEMPTS {
        let (stream, peer) = listener.accept().await.context("接受 OAuth 本機回呼失敗")?;
        if !peer.ip().is_loopback() {
            continue;
        }
        match process_callback_connection(stream, expected_state).await {
            Ok(ParsedCallback::Code(code)) => return Ok(code),
            Ok(ParsedCallback::Denied(message)) => bail!(message),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("未收到有效的 OAuth 本機回呼")))
}

async fn process_callback_connection(
    mut stream: TcpStream,
    expected_state: &str,
) -> Result<ParsedCallback> {
    let request = read_http_headers(&mut stream).await?;
    let parsed = parse_callback_request(&request, expected_state);
    let message = match &parsed {
        Ok(ParsedCallback::Code(_)) => "授權資料已收到。請回到 GamerCatch 視窗確認測試信結果。",
        _ => "授權失敗或收到無效的本機連線。請回到 GamerCatch 視窗查看結果。",
    };
    let response = browser_response(message);
    if let Err(error) = stream.write_all(response.as_bytes()).await {
        eprintln!("回覆 OAuth 瀏覽器頁面失敗：{error}");
    }
    parsed
}

async fn read_http_headers(stream: &mut TcpStream) -> Result<Vec<u8>> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 2_048];
    loop {
        let read = timeout(Duration::from_secs(30), stream.read(&mut buffer))
            .await
            .context("讀取 OAuth 本機回呼逾時")??;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        ensure!(
            request.len() <= MAX_CALLBACK_BYTES,
            "OAuth 本機回呼資料過大"
        );
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    ensure!(!request.is_empty(), "OAuth 本機回呼沒有資料");
    Ok(request)
}

fn parse_callback_request(request: &[u8], expected_state: &str) -> Result<ParsedCallback> {
    let request = std::str::from_utf8(request).context("OAuth 本機回呼不是有效 UTF-8")?;
    let request_line = request.lines().next().context("OAuth 本機回呼缺少要求列")?;
    let mut parts = request_line.split_whitespace();
    ensure!(parts.next() == Some("GET"), "OAuth 本機回呼只接受 GET");
    let target = parts.next().context("OAuth 本機回呼缺少網址")?;
    let base = Url::parse("http://127.0.0.1/")?;
    let callback = base.join(target).context("OAuth 本機回呼網址無效")?;
    ensure!(
        callback.host_str() == Some("127.0.0.1") && callback.path() == CALLBACK_PATH,
        "OAuth 本機回呼路徑無效"
    );
    let parameters = callback
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    let state = unique_query_value(&parameters, "state")?;
    ensure!(
        state == Some(expected_state),
        "OAuth state 不相符；為保護帳號已拒絕此次授權"
    );
    let code = unique_query_value(&parameters, "code")?;
    let error = unique_query_value(&parameters, "error")?;
    ensure!(
        code.is_none() || error.is_none(),
        "Google OAuth 回呼不可同時包含 code 與 error"
    );
    if let Some(error) = error {
        let description = unique_query_value(&parameters, "error_description")?
            .unwrap_or("使用者拒絕或 Google 未提供細節");
        return Ok(ParsedCallback::Denied(format!(
            "Google OAuth 拒絕授權：{error}（{description}）"
        )));
    }
    Ok(ParsedCallback::Code(
        code.context("Google OAuth 回呼缺少授權碼")?.to_owned(),
    ))
}

fn unique_query_value<'a>(
    parameters: &'a [(String, String)],
    key: &str,
) -> Result<Option<&'a str>> {
    let mut values = parameters
        .iter()
        .filter(|(name, _)| name == key)
        .map(|(_, value)| value.as_str());
    let value = values.next();
    ensure!(values.next().is_none(), "OAuth 回呼重複出現 {key} 參數");
    Ok(value)
}

fn browser_response(message: &str) -> String {
    let body = format!(
        "<!doctype html><html lang=\"zh-Hant\"><meta charset=\"utf-8\"><title>GamerCatch Gmail 授權</title><body><h1>{message}</h1><p>本頁可以關閉。</p></body></html>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("xdg-open").arg(url).status();

    let status = status.context("啟動系統瀏覽器失敗")?;
    ensure!(status.success(), "系統瀏覽器啟動命令失敗：{status}");
    Ok(())
}

async fn send_to_recipients(
    access_token: &str,
    sender: &str,
    recipients: &[String],
    subject: &str,
    body: &str,
) -> Result<usize> {
    let http_client = oauth_http_client()?;
    let mut sent = 0usize;
    let mut errors = Vec::new();
    for recipient in recipients {
        match send_one_message(&http_client, access_token, sender, recipient, subject, body).await {
            Ok(()) => sent += 1,
            Err(error) => errors.push(format!("{recipient}：{error:#}")),
        }
    }
    if !errors.is_empty() {
        bail!(
            "Gmail 測試信有 {} 位收件人寄送失敗：{}",
            errors.len(),
            errors.join("；")
        );
    }
    Ok(sent)
}

async fn send_one_message(
    client: &HttpClient,
    access_token: &str,
    sender: &str,
    recipient: &str,
    subject: &str,
    body: &str,
) -> Result<()> {
    let mime = build_mime_message(sender, recipient, subject, body)?;
    let payload = serde_json::to_vec(&serde_json::json!({
        "raw": URL_SAFE_NO_PAD.encode(mime),
    }))?;
    let send_url = gmail_send_url(sender)?;
    let mut last_error = None;
    for attempt in 0..SEND_ATTEMPTS {
        match gmail_request(client, send_url.as_str(), access_token, &payload).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                let delay = error
                    .retry_after
                    .unwrap_or_else(|| Duration::from_secs(1_u64 << attempt));
                let should_retry = error.retryable
                    && attempt + 1 < SEND_ATTEMPTS
                    && delay <= Duration::from_secs(60);
                last_error = Some(error.message);
                if !should_retry {
                    break;
                }
                sleep(delay).await;
            }
        }
    }
    bail!(
        "Gmail API 寄送失敗：{}",
        last_error.unwrap_or_else(|| "未知錯誤".to_owned())
    )
}

fn build_mime_message(sender: &str, recipient: &str, subject: &str, body: &str) -> Result<Vec<u8>> {
    let sender = sender
        .parse::<Mailbox>()
        .context("Gmail 寄件地址格式無效")?;
    let recipient = recipient
        .parse::<Mailbox>()
        .context("Gmail 收件地址格式無效")?;
    let message = Message::builder()
        .from(sender)
        .to(recipient)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_owned())
        .context("建立 Gmail MIME 郵件失敗")?;
    Ok(message.formatted())
}

async fn gmail_request(
    client: &HttpClient,
    send_url: &str,
    access_token: &str,
    payload: &[u8],
) -> std::result::Result<(), GmailRequestError> {
    let response = client
        .post(send_url)
        .bearer_auth(access_token)
        .header("Content-Type", "application/json; charset=utf-8")
        .body(payload.to_vec())
        .send()
        .await
        .map_err(|error| GmailRequestError {
            retryable: error.is_connect(),
            retry_after: None,
            message: if error.is_timeout() {
                format!("要求逾時；投遞狀態不明，為避免重複寄信不會自動重送：{error}")
            } else {
                format!("網路錯誤：{error}")
            },
        })?;
    let status = response.status();
    let retryable = status == StatusCode::TOO_MANY_REQUESTS;
    let retry_after = parse_retry_after(&response);
    if status.is_success() {
        return Ok(());
    }
    let detail = response
        .text()
        .await
        .unwrap_or_else(|_| "無法讀取 Google 回應".to_owned());
    Err(GmailRequestError {
        retryable,
        retry_after,
        message: format!(
            "HTTP {status}：{}",
            truncate_chars(&detail, MAX_RESPONSE_DETAIL_CHARS)
        ),
    })
}

fn gmail_send_url(sender: &str) -> Result<Url> {
    let mut url = Url::parse(GMAIL_API_BASE_URL)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Gmail API 固定網址無法加入寄件帳號"))?
        .push(sender)
        .push("messages")
        .push("send");
    Ok(url)
}

fn parse_retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_oauth_callback_state_and_code() {
        let request = b"GET /oauth/callback?state=safe-state&code=auth-code HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            parse_callback_request(request, "safe-state").unwrap(),
            ParsedCallback::Code("auth-code".to_owned())
        );
        assert!(parse_callback_request(request, "wrong-state").is_err());
    }

    #[test]
    fn reports_oauth_denial_without_accepting_a_code() {
        let request = b"GET /oauth/callback?state=safe&error=access_denied HTTP/1.1\r\n\r\n";
        let result = parse_callback_request(request, "safe").unwrap();
        assert!(
            matches!(result, ParsedCallback::Denied(message) if message.contains("access_denied"))
        );
    }

    #[test]
    fn rejects_duplicate_oauth_security_parameters() {
        let request = b"GET /oauth/callback?state=safe&state=attacker&code=x HTTP/1.1\r\n\r\n";
        assert!(parse_callback_request(request, "safe").is_err());
    }

    #[test]
    fn binds_gmail_send_endpoint_and_keyring_to_configured_identity() {
        let url = gmail_send_url("sender+alert@example.com").unwrap();
        assert!(
            url.as_str()
                .contains("sender+alert@example.com/messages/send")
        );

        let config = GmailNotificationsConfig {
            sender_email: "sender@example.com".to_owned(),
            ..GmailNotificationsConfig::default()
        };
        assert_ne!(
            keyring_username(&config, "client-a.apps.googleusercontent.com"),
            keyring_username(&config, "client-b.apps.googleusercontent.com")
        );
    }

    #[test]
    fn builds_utf8_mime_without_exposing_other_recipients() {
        let mime = build_mime_message(
            "sender@example.com",
            "one@example.com",
            "[GamerCatch] 夜鴉異常",
            "排行榜解析失敗",
        )
        .unwrap();
        let text = String::from_utf8_lossy(&mime);
        assert!(text.contains("one@example.com"));
        assert!(!text.contains("two@example.com"));
        assert!(text.contains("Content-Type: text/plain"));
    }

    #[test]
    fn truncates_large_error_details_at_character_boundaries() {
        assert_eq!(truncate_chars("夜鴉錯誤", 2), "夜鴉…");
        assert_eq!(truncate_chars("ok", 2), "ok");
    }

    #[test]
    fn groups_each_recipient_into_one_private_message() {
        let failures = vec![
            FailureRecord {
                game_name: Some("夜鴉".to_owned()),
                stage: "排行找不到".to_owned(),
                detail: "page 1-20".to_owned(),
                recipients: vec!["one@example.com".to_owned(), "two@example.com".to_owned()],
            },
            FailureRecord {
                game_name: Some("遊戲 B".to_owned()),
                stage: "Sheets 更新失敗".to_owned(),
                detail: "403".to_owned(),
                recipients: vec!["ONE@example.com".to_owned()],
            },
        ];
        let plans = plan_notifications(&failures);
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].recipient, "one@example.com");
        assert_eq!(plans[0].failures.len(), 2);
        assert_eq!(plans[1].failures.len(), 1);
    }

    #[tokio::test]
    async fn request_timeout_does_not_retry_an_uncertain_delivery() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            sleep(Duration::from_secs(1)).await;
        });
        let client =
            http_client_with_timeouts(Duration::from_millis(100), Duration::from_millis(100))
                .unwrap();
        let error = gmail_request(
            &client,
            &format!("http://{address}/gmail/send"),
            "test-access-token",
            b"{}",
        )
        .await
        .unwrap_err();
        server.abort();

        assert!(!error.retryable);
        assert!(error.message.contains("避免重複寄信"));
    }
}
