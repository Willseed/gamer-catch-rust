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

function pathsFor(configuration: GamerCatchConfig): string[] {
  return validateConfig(configuration).map((issue) => issue.path);
}

describe('escapeTomlString', () => {
  it('escapes quotes, backslashes, and TOML basic-string controls', () => {
    expect(escapeTomlString('say "hi" \\ path')).toBe('say \\"hi\\" \\\\ path');
    expect(escapeTomlString('\b\t\n\f\r')).toBe('\\b\\t\\n\\f\\r');
  });

  it('uses Unicode escapes for the remaining control characters and DEL', () => {
    expect(escapeTomlString('\u0000\u001f\u007f')).toBe('\\u0000\\u001F\\u007F');
  });

  it('preserves ordinary Unicode text', () => {
    expect(escapeTomlString('夜鴉 🎮')).toBe('夜鴉 🎮');
  });
});

describe('parseRecipients', () => {
  it('parses multiple people separated by commas, semicolons, or newlines', () => {
    expect(
      parseRecipients(
        ' owner@example.com,backup@example.com;\n team-one@example.com\r\nteam-two@example.com ',
      ),
    ).toEqual([
      'owner@example.com',
      'backup@example.com',
      'team-one@example.com',
      'team-two@example.com',
    ]);
  });

  it('drops blank entries without silently dropping or rewriting a real address', () => {
    expect(parseRecipients(' , ;\nOwner+Alerts@Example.COM;;')).toEqual([
      'Owner+Alerts@Example.COM',
    ]);
  });

  it('lets validation report case-insensitive duplicates', () => {
    const configuration = config();
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'alerts@example.com',
      defaultRecipients: parseRecipients('owner@example.com,OWNER@example.com'),
    };

    expect(pathsFor(configuration)).toContain('gmail.defaultRecipients');
  });
});

describe('serializeConfig', () => {
  it('documents and serializes the selected Bahamut ranking category', () => {
    const configuration = config();
    configuration.bahamut.category = 500;

    const output = serializeConfig(configuration);

    expect(output).toContain('# 30 = 手機排行榜；500 = PC 排行榜。整份設定共用同一分類。');
    expect(output).toContain('category = 500');
  });

  it('keeps each game account, sheet, worksheet, columns, and recipients independent', () => {
    const configuration = config([
      game({
        gameName: '夜鴉',
        writeToGoogleSheets: true,
        spreadsheetId: 'night-crows-sheet',
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
      game({
        gameName: '遊戲 C',
        writeToGoogleSheets: false,
        spreadsheetId: '',
        serviceAccountKeyFileName: 'account-c.json',
        worksheetName: '不寫入',
        notificationRecipients: [],
      }),
    ]);

    const blocks = serializeConfig(configuration).split('[[games]]').slice(1);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('game_name = "夜鴉"');
    expect(blocks[0]).toContain('spreadsheet_id = "night-crows-sheet"');
    expect(blocks[0]).toContain('service_account_key_path = "credentials/account-a.json"');
    expect(blocks[0]).toContain('notification_recipients = ["owner-a@example.com"]');
    expect(blocks[0]).not.toContain('account-b.json');

    expect(blocks[1]).toContain('game_name = "遊戲 B"');
    expect(blocks[1]).toContain('spreadsheet_id = "game-b-sheet"');
    expect(blocks[1]).toContain('first_data_row = 5');
    expect(blocks[1]).toContain('date_column = "D"');
    expect(blocks[1]).toContain(
      'notification_recipients = ["owner-b@example.com", "backup-b@example.com"]',
    );
    expect(blocks[1]).not.toContain('account-a.json');

    expect(blocks[2]).toContain('game_name = "遊戲 C"');
    expect(blocks[2]).toContain('write_to_google_sheets = false');
    expect(blocks[2]).toContain('notification_recipients = []');
  });

  it('normalizes a Google Sheets URL to its spreadsheet ID', () => {
    const configuration = config([
      game({
        writeToGoogleSheets: true,
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?usp=sharing#gid=42',
      }),
    ]);

    const output = serializeConfig(configuration);

    expect(pathsFor(configuration)).not.toContain('games.0.spreadsheetId');
    expect(output).toContain('spreadsheet_id = "abc_DEF-123"');
    expect(output).not.toContain('docs.google.com');
  });

  it('escapes user text when embedding it into generated TOML', () => {
    const output = serializeConfig(
      config([
        game({
          gameName: '夜"鴉\\測試',
          worksheetName: '排行"榜\\每日',
        }),
      ]),
    );

    expect(output).toContain('game_name = "夜\\"鴉\\\\測試"');
    expect(output).toContain('worksheet_name = "排行\\"榜\\\\每日"');
    expect(output.startsWith('\ufeff')).toBe(false);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('uses a valid integer fallback for an unfinished disabled game', () => {
    const configuration = config([
      game({ enabled: false, gameName: '', firstDataRow: Number.NaN }),
      game({ gameName: '仍啟用的遊戲', firstDataRow: 3 }),
    ]);

    const output = serializeConfig(configuration);

    expect(pathsFor(configuration)).not.toContain('games.0.firstDataRow');
    expect(output).not.toContain('first_data_row = NaN');
    expect(output.split('[[games]]')[1]).toContain('first_data_row = 2');
  });
});

describe('validateConfig sheet destinations', () => {
  it('rejects duplicate date, rank, and popularity columns inside one game', () => {
    const configuration = config([
      game({ dateColumn: ' a ', rankColumn: 'A', popularityColumn: 'C' }),
    ]);

    expect(pathsFor(configuration)).toContain('games.0.columns');
  });

  it('detects overlap across games after normalizing the URL, worksheet, and columns', () => {
    const configuration = config([
      game({
        gameName: '遊戲 A',
        writeToGoogleSheets: true,
        spreadsheetId: 'shared_sheet-1',
        worksheetName: '每日排行',
        dateColumn: 'A',
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

    expect(pathsFor(configuration)).toContain('games.1.dateColumn');
  });

  it('allows games to share a date column when their output columns are distinct', () => {
    const configuration = config([
      game({
        gameName: '遊戲 A',
        writeToGoogleSheets: true,
        spreadsheetId: 'shared-sheet',
        dateColumn: 'A',
        rankColumn: 'B',
        popularityColumn: 'C',
      }),
      game({
        gameName: '遊戲 B',
        writeToGoogleSheets: true,
        spreadsheetId: 'shared-sheet',
        dateColumn: 'A',
        rankColumn: 'D',
        popularityColumn: 'E',
      }),
    ]);

    expect(
      validateConfig(configuration).filter((issue) =>
        ['games.1.dateColumn', 'games.1.columns'].includes(issue.path),
      ),
    ).toEqual([]);
  });
});

describe('validateConfig Gmail recipients', () => {
  it.each([
    'a..b@example.com',
    '.owner@example.com',
    'owner.@example.com',
    'owner@-example.com',
    'owner@example-.com',
    'owner@example',
    'owner name@example.com',
  ])('rejects an address outside the Rust-compatible safe subset: %s', (senderEmail) => {
    const configuration = config();
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail,
      defaultRecipients: ['fallback@example.com'],
    };

    expect(pathsFor(configuration)).toContain('gmail.senderEmail');
  });

  it('accepts an ordinary Gmail-style address with a plus tag', () => {
    const configuration = config();
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'owner+gamercatch@example.com',
      defaultRecipients: ['fallback@example.com'],
    };

    expect(pathsFor(configuration)).not.toContain('gmail.senderEmail');
  });

  it('uses the Gmail default recipients as a fallback for an empty game list', () => {
    const configuration = config([
      game({ gameName: '遊戲 A', notificationRecipients: ['team-a@example.com'] }),
      game({ gameName: '遊戲 B', notificationRecipients: [] }),
    ]);
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'alerts@example.com',
      defaultRecipients: ['fallback@example.com'],
    };

    expect(
      validateConfig(configuration).filter((issue) =>
        issue.path.endsWith('.notificationRecipients'),
      ),
    ).toEqual([]);
  });

  it('reports each active game that has neither its own recipient nor a fallback', () => {
    const configuration = config([
      game({ gameName: '遊戲 A', notificationRecipients: ['team-a@example.com'] }),
      game({ gameName: '遊戲 B', notificationRecipients: [] }),
    ]);
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'alerts@example.com',
      defaultRecipients: [],
    };

    expect(pathsFor(configuration)).toContain('games.1.notificationRecipients');
    expect(pathsFor(configuration)).not.toContain('games.0.notificationRecipients');
  });

  it('ignores unfinished email placeholders while Gmail is disabled', () => {
    const configuration = config();
    configuration.gmail = {
      ...configuration.gmail,
      enabled: false,
      senderEmail: '請填入寄件帳號',
      defaultRecipients: ['請填入收件帳號'],
    };
    configuration.games[0].notificationRecipients = ['請填入收件帳號'];

    expect(
      validateConfig(configuration).filter(
        (issue) => issue.path.includes('Recipient') || issue.path.includes('recipient'),
      ),
    ).toEqual([]);
  });
});

describe('validateConfig credential paths', () => {
  it.each([
    '/tmp/service-account.json',
    'C:\\credentials\\service-account.json',
    '..\\service-account.json',
    'credentials/service-account.json',
    'folder/service-account.json',
    '\\\\server\\share\\service-account.json',
    'service-account.txt',
    '.json',
    ' service-account.json',
    'service-account.json\nignored',
  ])(
    'rejects anything other than one service-account JSON filename: %s',
    (serviceAccountKeyFileName) => {
      const configuration = config([
        game({ writeToGoogleSheets: true, spreadsheetId: 'sheet-a', serviceAccountKeyFileName }),
      ]);

      expect(pathsFor(configuration)).toContain('games.0.serviceAccountKeyFileName');
    },
  );

  it.each([
    '/tmp/gmail-oauth.json',
    'C:\\credentials\\gmail-oauth.json',
    '../gmail-oauth.json',
    '\\\\server\\share\\gmail-oauth.json',
  ])('rejects a dangerous Gmail OAuth path: %s', (oauthClientSecretPath) => {
    const configuration = config();
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'alerts@example.com',
      defaultRecipients: ['owner@example.com'],
      oauthClientSecretPath,
    };

    expect(pathsFor(configuration)).toContain('gmail.oauthClientSecretPath');
  });

  it('accepts a service-account JSON filename and a safe Gmail OAuth relative path', () => {
    const configuration = config([
      game({
        writeToGoogleSheets: true,
        spreadsheetId: 'sheet-a',
        serviceAccountKeyFileName: 'person-1-service-account.json',
      }),
    ]);
    configuration.gmail = {
      ...configuration.gmail,
      enabled: true,
      senderEmail: 'alerts@example.com',
      defaultRecipients: ['owner@example.com'],
      oauthClientSecretPath: 'credentials/gmail/oauth-client.json',
    };

    expect(pathsFor(configuration)).not.toContain('games.0.serviceAccountKeyFileName');
    expect(pathsFor(configuration)).not.toContain('gmail.oauthClientSecretPath');
  });
});

describe('validateConfig game limit', () => {
  it(`accepts exactly ${MAX_GAMES} games`, () => {
    const games = Array.from({ length: MAX_GAMES }, (_, index) =>
      game({ gameName: `遊戲 ${index + 1}`, writeToGoogleSheets: false }),
    );

    expect(pathsFor(config(games))).not.toContain('games');
  });

  it(`rejects more than ${MAX_GAMES} games`, () => {
    const games = Array.from({ length: MAX_GAMES + 1 }, (_, index) =>
      game({ gameName: `遊戲 ${index + 1}`, writeToGoogleSheets: false }),
    );

    expect(pathsFor(config(games))).toContain('games');
  });
});

describe('validateConfig Google Sheets URL security', () => {
  it('rejects a docs.google.com URL containing user information, matching Rust validation', () => {
    const configuration = config([
      game({
        writeToGoogleSheets: true,
        spreadsheetId: 'https://attacker@example.com@docs.google.com/spreadsheets/d/sheet-a/edit',
      }),
    ]);

    expect(pathsFor(configuration)).toContain('games.0.spreadsheetId');
  });
});
