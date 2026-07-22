import {
  DEFAULT_BAHAMUT,
  DEFAULT_GMAIL,
  MAX_GAMES,
  createDefaultGame,
  escapeTomlString,
  parseRecipients,
  serializeConfig,
  validateConfig,
  type GameSettings,
  type GamerCatchConfig,
} from './config-model';

function game(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    ...createDefaultGame(),
    gameName: '夜鴉',
    spreadsheetId: 'sheet-a',
    serviceAccountKeyFileName: 'night-crows-service-account.json',
    ...overrides,
    notificationRecipients: [...(overrides.notificationRecipients ?? [])],
  };
}

function config(games: GameSettings[] = [game()]): GamerCatchConfig {
  return {
    bahamut: { ...DEFAULT_BAHAMUT },
    gmail: {
      ...DEFAULT_GMAIL,
      defaultRecipients: [],
    },
    games,
  };
}

function enableGmail(
  configuration: GamerCatchConfig,
  overrides: Partial<GamerCatchConfig['gmail']> = {},
): void {
  configuration.gmail = {
    ...configuration.gmail,
    enabled: true,
    senderEmail: 'alerts@example.com',
    defaultRecipients: ['owner@example.com'],
    ...overrides,
  };
}

function pathsFor(configuration: GamerCatchConfig): string[] {
  return validateConfig(configuration).map((issue) => issue.path);
}

describe('config model high-risk contracts', () => {
  it('escapes every TOML injection boundary while preserving ordinary Unicode', () => {
    expect(escapeTomlString('say "hi" \\ path\b\t\n\f\r')).toBe(
      'say \\"hi\\" \\\\ path\\b\\t\\n\\f\\r',
    );
    expect(escapeTomlString('\u0000\u001f\u007f')).toBe('\\u0000\\u001F\\u007F');
    expect(escapeTomlString('夜鴉 🎮')).toBe('夜鴉 🎮');

    const output = serializeConfig(
      config([game({ gameName: '夜"鴉\\測試', worksheetName: '排行"榜\\每日' })]),
    );
    expect(output).toContain('game_name = "夜\\"鴉\\\\測試"');
    expect(output).toContain('worksheet_name = "排行\\"榜\\\\每日"');
    expect(output.startsWith('\ufeff')).toBe(false);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('parses recipient delimiters without rewriting addresses and flags normalized duplicates', () => {
    expect(
      parseRecipients(' owner@example.com,backup@example.com;\n Team+Alerts@Example.COM\r\n ; '),
    ).toEqual(['owner@example.com', 'backup@example.com', 'Team+Alerts@Example.COM']);

    const configuration = config();
    enableGmail(configuration, {
      defaultRecipients: parseRecipients('owner@example.com,OWNER@example.com'),
    });
    expect(pathsFor(configuration)).toContain('gmail.defaultRecipients');
  });

  it('serializes independent games, normalized Sheets IDs, and credential paths without cross-talk', () => {
    const configuration = config([
      game({
        gameName: '夜鴉',
        writeToGoogleSheets: true,
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/night_sheet-1/edit?usp=sharing',
        serviceAccountKeyFileName: 'account-a.json',
        worksheetName: '夜鴉日報',
        dateColumn: ' a ',
        rankColumn: ' b ',
        popularityColumn: ' c ',
        notificationRecipients: ['owner-a@example.com'],
      }),
      game({
        gameName: '遊戲 B',
        writeToGoogleSheets: true,
        spreadsheetId: 'game-b-sheet',
        serviceAccountKeyFileName: 'account-b.json',
        worksheetName: 'B 組資料',
        firstDataRow: 5,
        dateColumn: 'D',
        rankColumn: 'E',
        popularityColumn: 'F',
        notificationRecipients: ['owner-b@example.com', 'backup-b@example.com'],
      }),
    ]);
    configuration.bahamut.category = 500;
    enableGmail(configuration, { oauthClientSecretFileName: 'gmail-oauth.json' });

    const output = serializeConfig(configuration);
    const blocks = output.split('[[games]]').slice(1);

    expect(blocks).toHaveLength(2);
    expect(output).toContain('category = 500');
    expect(output).toContain('oauth_client_secret_path = "credentials/gmail-oauth.json"');
    expect(blocks[0]).toContain('spreadsheet_id = "night_sheet-1"');
    expect(blocks[0]).toContain('service_account_key_path = "credentials/account-a.json"');
    expect(blocks[0]).toContain('notification_recipients = ["owner-a@example.com"]');
    expect(blocks[0]).not.toContain('account-b.json');
    expect(blocks[1]).toContain('first_data_row = 5');
    expect(blocks[1]).toContain('date_column = "D"');
    expect(blocks[1]).toContain(
      'notification_recipients = ["owner-b@example.com", "backup-b@example.com"]',
    );
    expect(blocks[1]).not.toContain('account-a.json');
  });

  it('reports every required active field but ignores and safely serializes an unfinished disabled game', () => {
    const configuration = config([
      game({
        spreadsheetId: '',
        worksheetName: '',
        dateColumn: '',
        rankColumn: '',
      }),
      game({
        enabled: false,
        gameName: '',
        spreadsheetId: '',
        serviceAccountKeyFileName: '',
        worksheetName: '',
        firstDataRow: Number.NaN,
      }),
    ]);

    expect(pathsFor(configuration)).toEqual(
      expect.arrayContaining([
        'games.0.spreadsheetId',
        'games.0.worksheetName',
        'games.0.dateColumn',
        'games.0.rankColumn',
      ]),
    );
    expect(
      validateConfig(configuration).filter((issue) => issue.path.startsWith('games.1')),
    ).toEqual([]);
    expect(serializeConfig(configuration).split('[[games]]')[2]).toContain('first_data_row = 2');
  });

  it('matches Rust collision safety after normalizing sheet, worksheet, and column values', () => {
    const duplicateInsideGame = config([
      game({ dateColumn: ' a ', rankColumn: 'A', popularityColumn: 'C' }),
    ]);
    expect(pathsFor(duplicateInsideGame)).toContain('games.0.rankColumn');

    const overlappingGames = config([
      game({
        gameName: '遊戲 A',
        writeToGoogleSheets: true,
        spreadsheetId: 'shared_sheet-1',
        worksheetName: '每日排行',
        rankColumn: 'B',
        popularityColumn: 'C',
      }),
      game({
        gameName: '遊戲 B',
        writeToGoogleSheets: true,
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/shared_sheet-1/edit#gid=0',
        worksheetName: '  每日排行  ',
        dateColumn: ' b ',
        rankColumn: 'D',
        popularityColumn: 'E',
      }),
    ]);
    expect(pathsFor(overlappingGames)).toContain('games.1.dateColumn');

    overlappingGames.games[1].dateColumn = 'A';
    expect(
      validateConfig(overlappingGames).filter((issue) =>
        ['games.1.dateColumn', 'games.1.rankColumn', 'games.1.popularityColumn'].includes(
          issue.path,
        ),
      ),
    ).toEqual([]);
  });

  it('matches the Rust-compatible email subset, including header injection and duplicates', () => {
    const rejected = [
      'a..b@example.com',
      '.owner@example.com',
      'owner.@example.com',
      'owner@-example.com',
      'owner@example-.com',
      'owner@example',
      'owner name@example.com',
      'owner@example.com\nBcc:attacker@example.com',
    ];

    for (const senderEmail of rejected) {
      const configuration = config();
      enableGmail(configuration, { senderEmail });
      expect(pathsFor(configuration), senderEmail).toContain('gmail.senderEmail');
    }

    const valid = config();
    enableGmail(valid, { senderEmail: 'owner+gamercatch@example.com' });
    expect(pathsFor(valid)).not.toContain('gmail.senderEmail');

    enableGmail(valid, { defaultRecipients: ['owner@example.com', 'OWNER@example.com'] });
    expect(pathsFor(valid)).toContain('gmail.defaultRecipients');
  });

  it('enforces Gmail fallback recipients only while notifications are enabled', () => {
    const configuration = config([
      game({ gameName: '遊戲 A', notificationRecipients: ['team-a@example.com'] }),
      game({ gameName: '遊戲 B', notificationRecipients: [] }),
    ]);
    enableGmail(configuration, { defaultRecipients: ['fallback@example.com'] });
    expect(
      validateConfig(configuration).filter((issue) =>
        issue.path.endsWith('.notificationRecipients'),
      ),
    ).toEqual([]);

    configuration.gmail.defaultRecipients = [];
    expect(pathsFor(configuration)).toContain('games.1.notificationRecipients');
    expect(pathsFor(configuration)).not.toContain('games.0.notificationRecipients');

    configuration.gmail.enabled = false;
    configuration.gmail.senderEmail = '請填入寄件帳號';
    configuration.gmail.defaultRecipients = ['請填入收件帳號'];
    configuration.games[0].notificationRecipients = ['請填入收件帳號'];
    expect(
      validateConfig(configuration).filter((issue) =>
        issue.path.toLocaleLowerCase('en-US').includes('recipient'),
      ),
    ).toEqual([]);
  });

  it('accepts filenames only and rejects credential path traversal before serialization', () => {
    const rejected = [
      '/tmp/credential.json',
      'C:\\credentials\\credential.json',
      '..\\credential.json',
      '../credential.json',
      'credentials/credential.json',
      'folder/credential.json',
      '\\\\server\\share\\credential.json',
      'credential.txt',
      '.json',
      ' credential.json',
      'credential.json\nignored',
    ];

    for (const fileName of rejected) {
      const serviceAccountConfig = config([game({ serviceAccountKeyFileName: fileName })]);
      expect(pathsFor(serviceAccountConfig), fileName).toContain(
        'games.0.serviceAccountKeyFileName',
      );

      const gmailConfig = config();
      enableGmail(gmailConfig, { oauthClientSecretFileName: fileName });
      expect(pathsFor(gmailConfig), fileName).toContain('gmail.oauthClientSecretFileName');
    }

    const valid = config([game({ serviceAccountKeyFileName: 'person-1-service-account.json' })]);
    enableGmail(valid, { oauthClientSecretFileName: 'gmail-oauth-client.json' });
    expect(pathsFor(valid)).not.toContain('games.0.serviceAccountKeyFileName');
    expect(pathsFor(valid)).not.toContain('gmail.oauthClientSecretFileName');
    const output = serializeConfig(valid);
    expect(output).toContain(
      'service_account_key_path = "credentials/person-1-service-account.json"',
    );
    expect(output).toContain('oauth_client_secret_path = "credentials/gmail-oauth-client.json"');
  });

  it(`enforces the ${MAX_GAMES}-game safety boundary`, () => {
    const games = Array.from({ length: MAX_GAMES }, (_, index) =>
      game({ gameName: `遊戲 ${index + 1}`, writeToGoogleSheets: false }),
    );

    expect(pathsFor(config(games))).not.toContain('games');
    expect(pathsFor(config([...games, game({ gameName: '超出上限' })]))).toContain('games');
    expect(pathsFor(config([]))).toContain('games');
  });

  it('normalizes canonical Sheets URLs and rejects authority confusion like Rust', () => {
    const valid = config([
      game({
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?usp=sharing#gid=42',
      }),
    ]);
    expect(pathsFor(valid)).not.toContain('games.0.spreadsheetId');
    expect(serializeConfig(valid)).toContain('spreadsheet_id = "abc_DEF-123"');

    const rejected = [
      'https://attacker@example.com@docs.google.com/spreadsheets/d/sheet-a/edit',
      'http://docs.google.com/spreadsheets/d/sheet-a/edit',
      'https://example.com/spreadsheets/d/sheet-a/edit',
      'https://docs.google.com:444/spreadsheets/d/sheet-a/edit',
    ];
    for (const spreadsheetId of rejected) {
      expect(pathsFor(config([game({ spreadsheetId })])), spreadsheetId).toContain(
        'games.0.spreadsheetId',
      );
    }
  });
});
