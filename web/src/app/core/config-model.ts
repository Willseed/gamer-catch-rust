export const MAX_GAMES = 20;
export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT_PREFIX_LENGTH = 60;

export interface BahamutSettings {
  category: number;
  startPage: number;
  endPage: number;
  navigationTimeoutMs: number;
  pageDelayMs: number;
  headless: boolean;
}

export interface GmailSettings {
  enabled: boolean;
  senderEmail: string;
  defaultRecipients: string[];
  oauthClientSecretPath: string;
  subjectPrefix: string;
}

export interface GameSettings {
  enabled: boolean;
  gameName: string;
  writeToGoogleSheets: boolean;
  spreadsheetId: string;
  serviceAccountKeyPath: string;
  worksheetName: string;
  timezone: string;
  firstDataRow: number;
  dateColumn: string;
  rankColumn: string;
  popularityColumn: string;
  notificationRecipients: string[];
}

export interface GamerCatchConfig {
  bahamut: BahamutSettings;
  gmail: GmailSettings;
  games: GameSettings[];
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export const DEFAULT_BAHAMUT: Readonly<BahamutSettings> = {
  category: 30,
  startPage: 1,
  endPage: 20,
  navigationTimeoutMs: 120_000,
  pageDelayMs: 1_000,
  headless: false,
};

export const DEFAULT_GMAIL: Readonly<GmailSettings> = {
  enabled: false,
  senderEmail: '',
  defaultRecipients: [],
  oauthClientSecretPath: 'credentials/gmail-oauth-client.json',
  subjectPrefix: '[GamerCatch]',
};

export function createDefaultGame(index = 0): GameSettings {
  return {
    enabled: true,
    gameName: index === 0 ? '夜鴉' : '',
    writeToGoogleSheets: false,
    spreadsheetId: '',
    serviceAccountKeyPath: `credentials/person-${index + 1}-service-account.json`,
    worksheetName: '每日排名',
    timezone: 'Asia/Taipei',
    firstDataRow: 2,
    dateColumn: 'A',
    rankColumn: 'B',
    popularityColumn: 'C',
    notificationRecipients: [],
  };
}

export function parseRecipients(value: string): string[] {
  return value
    .split(/[\n,;]+/u)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

export function escapeTomlString(value: string): string {
  let result = '';
  for (const character of value) {
    switch (character) {
      case '\b':
        result += '\\b';
        break;
      case '\t':
        result += '\\t';
        break;
      case '\n':
        result += '\\n';
        break;
      case '\f':
        result += '\\f';
        break;
      case '\r':
        result += '\\r';
        break;
      case '"':
        result += '\\"';
        break;
      case '\\':
        result += '\\\\';
        break;
      default: {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint < 0x20 || codePoint === 0x7f) {
          const width = codePoint <= 0xffff ? 4 : 8;
          const marker = width === 4 ? 'u' : 'U';
          result += `\\${marker}${codePoint.toString(16).toUpperCase().padStart(width, '0')}`;
        } else {
          result += character;
        }
      }
    }
  }
  return result;
}

function tomlString(value: string): string {
  return `"${escapeTomlString(value)}"`;
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function normalizeColumn(value: string): string {
  return value.trim().toUpperCase();
}

function isEmail(value: string): boolean {
  if (value.length > 254 || value !== value.trim()) {
    return false;
  }
  const parts = value.split('@');
  if (parts.length !== 2) {
    return false;
  }
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u.test(local)
  ) {
    return false;
  }
  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
    )
  );
}

function tomlUnsignedInteger(value: number, fallback: number): string {
  return String(Number.isSafeInteger(value) && value >= 0 ? value : fallback);
}

function hasUniqueEmails(values: string[]): boolean {
  const normalized = values.map((value) => value.toLocaleLowerCase('en-US'));
  return new Set(normalized).size === normalized.length;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

function isSafeRelativePath(value: string): boolean {
  const path = value.trim().replaceAll('\\', '/');
  return (
    path.length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(path) &&
    !path.startsWith('/') &&
    !/^[a-z]:\//iu.test(path) &&
    !path.startsWith('//') &&
    !path.split('/').some((part) => part === '.' || part === '..' || part.length === 0)
  );
}

function normalizeSpreadsheetId(value: string): string | null {
  const candidate = value.trim();
  if (/^[A-Za-z0-9_-]+$/u.test(candidate)) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'docs.google.com' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/u.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function addEmailIssues(
  issues: ConfigIssue[],
  values: string[],
  path: string,
  label: string,
): void {
  if (values.length > MAX_RECIPIENTS) {
    issues.push({ path, message: `${label}最多只能填 ${MAX_RECIPIENTS} 個地址。` });
  }
  if (values.some((value) => !isEmail(value))) {
    issues.push({ path, message: `${label}包含格式不正確的電子郵件。` });
  }
  if (!hasUniqueEmails(values)) {
    issues.push({ path, message: `${label}有重複的電子郵件（不分大小寫）。` });
  }
}

function addGameIssues(
  issues: ConfigIssue[],
  game: GameSettings,
  index: number,
  validateNotifications: boolean,
): void {
  if (!game.enabled) {
    return;
  }
  const name = game.gameName.trim();
  const prefix = `games.${index}`;
  if (!name) {
    issues.push({ path: `${prefix}.gameName`, message: `遊戲 ${index + 1}：遊戲名稱不可留白。` });
  }
  if (!isTimeZone(game.timezone)) {
    issues.push({
      path: `${prefix}.timezone`,
      message: `遊戲「${name || index + 1}」：時區格式不正確。`,
    });
  }
  if (!Number.isInteger(game.firstDataRow) || game.firstDataRow < 2) {
    issues.push({
      path: `${prefix}.firstDataRow`,
      message: `遊戲「${name || index + 1}」：資料起始列至少要是 2。`,
    });
  }

  const columns = [game.dateColumn, game.rankColumn, game.popularityColumn].map(normalizeColumn);
  if (columns.some((column) => !/^[A-Z]{1,3}$/u.test(column))) {
    issues.push({
      path: `${prefix}.columns`,
      message: `遊戲「${name || index + 1}」：欄位請填 A、B、AA 這類英文字母。`,
    });
  } else if (new Set(columns).size !== columns.length) {
    issues.push({
      path: `${prefix}.columns`,
      message: `遊戲「${name || index + 1}」：日期、排行、人氣欄位不可重複。`,
    });
  }

  if (validateNotifications) {
    addEmailIssues(
      issues,
      game.notificationRecipients,
      `${prefix}.notificationRecipients`,
      `遊戲「${name || index + 1}」的通知收件人`,
    );
  }

  if (!game.writeToGoogleSheets) {
    return;
  }
  if (!normalizeSpreadsheetId(game.spreadsheetId)) {
    issues.push({
      path: `${prefix}.spreadsheetId`,
      message: `遊戲「${name || index + 1}」：請貼上正確的 Google 試算表網址或 ID。`,
    });
  }
  if (!game.worksheetName.trim() || /[\u0000-\u001f\u007f]/u.test(game.worksheetName)) {
    issues.push({
      path: `${prefix}.worksheetName`,
      message: `遊戲「${name || index + 1}」：工作表名稱不可留白或換行。`,
    });
  }
  if (!isSafeRelativePath(game.serviceAccountKeyPath)) {
    issues.push({
      path: `${prefix}.serviceAccountKeyPath`,
      message: `遊戲「${name || index + 1}」：JSON 路徑請填 credentials/檔名.json，且不可使用絕對路徑或 ..。`,
    });
  }
}

function addDestinationCollisionIssues(issues: ConfigIssue[], games: GameSettings[]): void {
  const dateCells = new Set<string>();
  const outputCells = new Set<string>();
  games.forEach((game, index) => {
    if (!game.enabled || !game.writeToGoogleSheets) {
      return;
    }
    const spreadsheet = normalizeSpreadsheetId(game.spreadsheetId);
    if (!spreadsheet || !game.worksheetName.trim()) {
      return;
    }
    const destination = `${spreadsheet}\u0000${game.worksheetName.trim()}\u0000`;
    const dateCell = destination + normalizeColumn(game.dateColumn);
    if (outputCells.has(dateCell)) {
      issues.push({
        path: `games.${index}.dateColumn`,
        message: `遊戲「${game.gameName}」：日期欄位與另一個遊戲的輸出欄位重疊。`,
      });
    }
    dateCells.add(dateCell);
    for (const column of [game.rankColumn, game.popularityColumn]) {
      const outputCell = destination + normalizeColumn(column);
      if (dateCells.has(outputCell) || outputCells.has(outputCell)) {
        issues.push({
          path: `games.${index}.columns`,
          message: `遊戲「${game.gameName}」：Google Sheets 輸出欄位與另一個遊戲重疊。`,
        });
      }
      outputCells.add(outputCell);
    }
  });
}

export function validateConfig(config: GamerCatchConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { bahamut, gmail, games } = config;

  if (!Number.isInteger(bahamut.category) || bahamut.category <= 0) {
    issues.push({ path: 'bahamut.category', message: '巴哈分類編號必須是大於 0 的整數。' });
  }
  if (!Number.isInteger(bahamut.startPage) || bahamut.startPage < 1) {
    issues.push({ path: 'bahamut.startPage', message: '起始頁至少要是 1。' });
  }
  if (
    !Number.isInteger(bahamut.endPage) ||
    bahamut.endPage < bahamut.startPage ||
    bahamut.endPage > 200
  ) {
    issues.push({ path: 'bahamut.endPage', message: '結束頁必須大於等於起始頁，且不可超過 200。' });
  }
  if (
    !Number.isInteger(bahamut.navigationTimeoutMs) ||
    bahamut.navigationTimeoutMs < 1_000 ||
    bahamut.navigationTimeoutMs > 120_000
  ) {
    issues.push({
      path: 'bahamut.navigationTimeoutMs',
      message: '頁面逾時必須介於 1,000 到 120,000 毫秒。',
    });
  }
  if (
    !Number.isInteger(bahamut.pageDelayMs) ||
    bahamut.pageDelayMs < 0 ||
    bahamut.pageDelayMs > 60_000
  ) {
    issues.push({ path: 'bahamut.pageDelayMs', message: '翻頁等待必須介於 0 到 60,000 毫秒。' });
  }
  if (games.length === 0 || games.length > MAX_GAMES) {
    issues.push({ path: 'games', message: `遊戲數量必須介於 1 到 ${MAX_GAMES} 個。` });
  }
  if (!games.some((game) => game.enabled)) {
    issues.push({ path: 'games', message: '至少要啟用一個遊戲。' });
  }
  games.forEach((game, index) => addGameIssues(issues, game, index, gmail.enabled));
  addDestinationCollisionIssues(issues, games);

  if (gmail.enabled) {
    addEmailIssues(issues, gmail.defaultRecipients, 'gmail.defaultRecipients', '預設通知收件人');
    if (!isEmail(gmail.senderEmail) || gmail.senderEmail !== gmail.senderEmail.trim()) {
      issues.push({ path: 'gmail.senderEmail', message: 'Gmail 寄件帳號格式不正確。' });
    }
    if (!isSafeRelativePath(gmail.oauthClientSecretPath)) {
      issues.push({
        path: 'gmail.oauthClientSecretPath',
        message: 'Gmail OAuth JSON 路徑請填 credentials/檔名.json，且不可使用絕對路徑或 ..。',
      });
    }
    if (
      !gmail.subjectPrefix.trim() ||
      gmail.subjectPrefix !== gmail.subjectPrefix.trim() ||
      [...gmail.subjectPrefix].length > MAX_SUBJECT_PREFIX_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(gmail.subjectPrefix)
    ) {
      issues.push({
        path: 'gmail.subjectPrefix',
        message: `信件主旨前綴不可留白、前後留空或超過 ${MAX_SUBJECT_PREFIX_LENGTH} 個字。`,
      });
    }
    const allRecipients = new Set(
      gmail.defaultRecipients.map((value) => value.toLocaleLowerCase('en-US')),
    );
    games
      .filter((game) => game.enabled)
      .forEach((game, index) => {
        const recipients =
          game.notificationRecipients.length > 0
            ? game.notificationRecipients
            : gmail.defaultRecipients;
        if (recipients.length === 0) {
          issues.push({
            path: `games.${index}.notificationRecipients`,
            message: `遊戲「${game.gameName || index + 1}」沒有可用的通知收件人。`,
          });
        }
        recipients.forEach((value) => allRecipients.add(value.toLocaleLowerCase('en-US')));
      });
    if (allRecipients.size > MAX_RECIPIENTS) {
      issues.push({
        path: 'gmail.recipients',
        message: `所有遊戲合計最多支援 ${MAX_RECIPIENTS} 個不同收件人。`,
      });
    }
  }
  return issues;
}

export function serializeConfig(config: GamerCatchConfig): string {
  const lines: string[] = [
    '# 由 GamerCatch 網頁設定產生器建立。請勿放入真正的 JSON 內容。',
    'schema_version = 2',
    '',
    '[bahamut]',
    'base_url = "https://forum.gamer.com.tw/"',
    `category = ${tomlUnsignedInteger(config.bahamut.category, DEFAULT_BAHAMUT.category)}`,
    `start_page = ${tomlUnsignedInteger(config.bahamut.startPage, DEFAULT_BAHAMUT.startPage)}`,
    `end_page = ${tomlUnsignedInteger(config.bahamut.endPage, DEFAULT_BAHAMUT.endPage)}`,
    `navigation_timeout_ms = ${tomlUnsignedInteger(
      config.bahamut.navigationTimeoutMs,
      DEFAULT_BAHAMUT.navigationTimeoutMs,
    )}`,
    `page_delay_ms = ${tomlUnsignedInteger(
      config.bahamut.pageDelayMs,
      DEFAULT_BAHAMUT.pageDelayMs,
    )}`,
    `headless = ${config.bahamut.headless}`,
    '',
    '# Gmail 異常通知（選用）',
    '[gmail_notifications]',
    `enabled = ${config.gmail.enabled}`,
    `sender_email = ${tomlString(config.gmail.senderEmail.trim())}`,
    `default_recipients = ${tomlArray(config.gmail.defaultRecipients)}`,
    `oauth_client_secret_path = ${tomlString(config.gmail.oauthClientSecretPath.trim())}`,
    `subject_prefix = ${tomlString(config.gmail.subjectPrefix)}`,
  ];

  config.games.forEach((game, index) => {
    const spreadsheet = normalizeSpreadsheetId(game.spreadsheetId) ?? game.spreadsheetId.trim();
    lines.push(
      '',
      `# 遊戲 ${index + 1}`,
      '[[games]]',
      `enabled = ${game.enabled}`,
      `game_name = ${tomlString(game.gameName.trim())}`,
      `write_to_google_sheets = ${game.writeToGoogleSheets}`,
      `spreadsheet_id = ${tomlString(spreadsheet)}`,
      `service_account_key_path = ${tomlString(game.serviceAccountKeyPath.trim())}`,
      `worksheet_name = ${tomlString(game.worksheetName.trim())}`,
      `timezone = ${tomlString(game.timezone.trim())}`,
      `first_data_row = ${tomlUnsignedInteger(game.firstDataRow, 2)}`,
      `date_column = ${tomlString(normalizeColumn(game.dateColumn))}`,
      `rank_column = ${tomlString(normalizeColumn(game.rankColumn))}`,
      `popularity_column = ${tomlString(normalizeColumn(game.popularityColumn))}`,
      `notification_recipients = ${tomlArray(game.notificationRecipients)}`,
    );
  });
  return `${lines.join('\n')}\n`;
}
