import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GeneratorPage } from './generator';

describe('GeneratorPage', () => {
  let fixture: ComponentFixture<GeneratorPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GeneratorPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GeneratorPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('explains the mobile and PC ranking category values next to the input', () => {
    const element = fixture.nativeElement as HTMLElement;
    const categoryInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="category"]',
    );
    const categoryHelp = element.querySelector('#category-help');

    expect(categoryInput?.value).toBe('30');
    expect(categoryInput?.getAttribute('aria-describedby')).toBe('category-help');
    expect(categoryHelp?.textContent).toContain('30 = 手機排行榜');
    expect(categoryHelp?.textContent).toContain('500 = PC 排行榜');
    expect(categoryHelp?.textContent).toContain('所有啟用遊戲都必須出現在同一個排行榜');
  });

  it('uses category 500 in the generated config when PC ranking is selected', () => {
    fixture.componentInstance.form.controls.bahamut.controls.category.setValue(500);

    expect(fixture.componentInstance.preview()).toContain('category = 500');
  });

  it('shows setup step 2 and points the final action to the placement instructions', () => {
    const element = fixture.nativeElement as HTMLElement;
    const currentStep = element.querySelector('app-setup-progress [aria-current="step"]');
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    const placementLink = element.querySelector<HTMLAnchorElement>(
      'a[href="/guide#config-placement"]',
    );

    expect(currentStep?.textContent).toContain('步驟 2');
    expect(currentStep?.textContent).toContain('產生設定');
    expect(downloadButton?.textContent).toContain('步驟 3：下載 config.toml');
    expect(placementLink?.textContent).toContain('下載後放在哪裡');
  });

  it('asks for only the service-account JSON filename and shows the fixed directory', () => {
    const element = fixture.nativeElement as HTMLElement;
    const fileNameInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="serviceAccountKeyFileName"]',
    );
    const prefix = element.querySelector('.credential-path-prefix');
    const help = element.querySelector('#service-account-file-help-0');
    const guideLink = element.querySelector<HTMLAnchorElement>('a[href="/guide#service-account"]');

    expect(fileNameInput?.value).toBe('person-1-service-account.json');
    expect(fileNameInput?.id).toBe('service-account-file-0');
    expect(prefix?.textContent?.trim()).toBe('credentials/');
    expect(help?.textContent).toContain('只需填 JSON 檔名，例如 ABC.json');
    expect(help?.textContent).toContain('產生器會自動加上 credentials/');
    expect(guideLink?.textContent).toContain('查看建立 service account JSON 教學');
  });

  it('adds credentials/ to the filename in the generated TOML', () => {
    fixture.componentInstance.games.at(0).controls.serviceAccountKeyFileName.setValue('ABC.json');

    expect(fixture.componentInstance.preview()).toContain(
      'service_account_key_path = "credentials/ABC.json"',
    );
    expect(fixture.componentInstance.preview()).not.toContain('credentials/credentials/');
  });

  it('uses the same filename-only pattern for the Gmail OAuth JSON', () => {
    const gmail = fixture.componentInstance.form.controls.gmail.controls;
    gmail.enabled.setValue(true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="oauthClientSecretFileName"]',
    );
    const field = input?.closest('.form-field');
    const prefix = field?.querySelector('.credential-path-prefix');
    const help = field?.querySelector('#gmail-oauth-client-file-help');
    const guideLink = field?.querySelector<HTMLAnchorElement>('a[href="/guide#gmail-oauth"]');

    expect(input?.value).toBe('gmail-oauth-client.json');
    expect(prefix?.textContent?.trim()).toBe('credentials/');
    expect(help?.textContent).toContain('只需填 JSON 檔名');
    expect(help?.textContent).toContain('產生器會自動加上 credentials/');
    expect(guideLink?.textContent).toContain('查看建立 Gmail OAuth JSON 教學');

    gmail.oauthClientSecretFileName.setValue('my-gmail-oauth.json');
    expect(fixture.componentInstance.preview()).toContain(
      'oauth_client_secret_path = "credentials/my-gmail-oauth.json"',
    );

    gmail.oauthClientSecretFileName.setValue('credentials/my-gmail-oauth.json');
    expect(fixture.componentInstance.issues()).toContainEqual(
      expect.objectContaining({
        path: 'gmail.oauthClientSecretFileName',
        message: expect.stringContaining('只需填檔名'),
      }),
    );
  });

  it('rejects a full credentials path because the field accepts a filename only', () => {
    fixture.componentInstance.games
      .at(0)
      .controls.serviceAccountKeyFileName.setValue('credentials/ABC.json');

    expect(fixture.componentInstance.issues()).toContainEqual(
      expect.objectContaining({
        path: 'games.0.serviceAccountKeyFileName',
        message: expect.stringContaining('只需填檔名'),
      }),
    );
  });

  it('syncs game recipients into the defaults without replacing manually entered addresses', () => {
    const defaults = fixture.componentInstance.form.controls.gmail.controls.defaultRecipientsText;
    const gameRecipients =
      fixture.componentInstance.games.at(0).controls.notificationRecipientsText;
    defaults.setValue('fallback@example.com\nOWNER@example.com');

    gameRecipients.setValue('owner@example.com, game@example.com');
    fixture.detectChanges();

    expect(defaults.value).toBe('fallback@example.com\nOWNER@example.com\ngame@example.com');
    expect(fixture.componentInstance.preview()).toContain(
      'default_recipients = ["fallback@example.com", "OWNER@example.com", "game@example.com"]',
    );
    const help = (fixture.nativeElement as HTMLElement)
      .querySelector('textarea[formcontrolname="notificationRecipientsText"]')
      ?.closest('label')
      ?.querySelector('small');
    expect(help?.textContent).toContain('會同步加入下一節的「預設通知收件人」');
  });

  it('replaces stale auto-synced recipients while preserving manual defaults', () => {
    const defaults = fixture.componentInstance.form.controls.gmail.controls.defaultRecipientsText;
    const gameRecipients =
      fixture.componentInstance.games.at(0).controls.notificationRecipientsText;
    defaults.setValue('fallback@example.com');

    gameRecipients.setValue('old@example.com');
    expect(defaults.value).toBe('fallback@example.com\nold@example.com');

    gameRecipients.setValue('new@example.com');
    expect(defaults.value).toBe('fallback@example.com\nnew@example.com');

    gameRecipients.setValue('');
    expect(defaults.value).toBe('fallback@example.com');
  });

  it('does not move the caret while typing and restores synchronized recipients on blur', () => {
    const gmail = fixture.componentInstance.form.controls.gmail.controls;
    fixture.componentInstance.games
      .at(0)
      .controls.notificationRecipientsText.setValue('game@example.com');
    gmail.enabled.setValue(true);
    fixture.detectChanges();

    const textarea = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      'textarea[formcontrolname="defaultRecipientsText"]',
    );
    if (!textarea) {
      throw new Error('找不到預設通知收件人欄位');
    }

    textarea.value = 'm';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(gmail.defaultRecipientsText.value).toBe('m');
    expect(textarea.value).toBe('m');
    expect(textarea.selectionStart).toBe(1);

    textarea.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(gmail.defaultRecipientsText.value).toBe('m\ngame@example.com');
    expect(textarea.value).toBe('m\ngame@example.com');
  });

  it('restores synchronized recipients before downloading', () => {
    const game = fixture.componentInstance.games.at(0).controls;
    const defaults = fixture.componentInstance.form.controls.gmail.controls.defaultRecipientsText;
    game.spreadsheetId.setValue('sheet-a');
    game.notificationRecipientsText.setValue('game@example.com');
    defaults.setValue('');
    const createObjectURL = vi.fn(() => 'blob:config');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    fixture.componentInstance.downloadConfig();

    expect(defaults.value).toBe('game@example.com');
    expect(fixture.componentInstance.preview()).toContain(
      'default_recipients = ["game@example.com"]',
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('keeps recipient synchronization correct when games are disabled or removed', () => {
    const defaults = fixture.componentInstance.form.controls.gmail.controls.defaultRecipientsText;
    fixture.componentInstance.games
      .at(0)
      .controls.notificationRecipientsText.setValue('shared@example.com');
    fixture.componentInstance.addGame();
    const secondGame = fixture.componentInstance.games.at(1).controls;

    secondGame.notificationRecipientsText.setValue('SHARED@example.com, second@example.com');
    expect(defaults.value).toBe('shared@example.com\nsecond@example.com');

    secondGame.enabled.setValue(false);
    expect(defaults.value).toBe('shared@example.com');

    secondGame.enabled.setValue(true);
    expect(defaults.value).toBe('shared@example.com\nsecond@example.com');

    fixture.componentInstance.removeGame(1);
    expect(defaults.value).toBe('shared@example.com');
  });

  it('makes required fields optional when a game is disabled', () => {
    const game = fixture.componentInstance.games.at(0).controls;
    game.gameName.setValue('');
    game.enabled.setValue(false);
    fixture.detectChanges();

    const gameNameInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[formcontrolname="gameName"]',
    );

    expect(gameNameInput?.required).toBe(false);
    expect(game.gameName.hasError('required')).toBe(false);
  });

  it('keeps download clickable, blocks an incomplete config, and focuses its first field', () => {
    const element = fixture.nativeElement as HTMLElement;
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    const spreadsheetInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="spreadsheetId"]',
    );
    if (!downloadButton || !spreadsheetInput) {
      throw new Error('找不到下載按鈕或試算表欄位');
    }

    const scrollIntoView = vi.fn();
    Object.defineProperty(spreadsheetInput, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(spreadsheetInput, 'focus');
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    expect(downloadButton.disabled).toBe(false);
    downloadButton.click();
    fixture.detectChanges();

    expect(anchorClick).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(spreadsheetInput.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.componentInstance.message()).toContain('完成所有必填欄位');
  });

  it('focuses the topmost invalid field when several required fields are empty', () => {
    const game = fixture.componentInstance.games.at(0).controls;
    game.serviceAccountKeyFileName.setValue('');
    game.worksheetName.setValue('');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const worksheetInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="worksheetName"]',
    );
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    if (!worksheetInput || !downloadButton) {
      throw new Error('找不到下載按鈕或工作表欄位');
    }

    const scrollIntoView = vi.fn();
    Object.defineProperty(worksheetInput, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(worksheetInput, 'focus');

    expect(fixture.componentInstance.issues()[0].path).not.toBe('games.0.worksheetName');
    downloadButton.click();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('opens advanced settings before focusing an invalid field inside them', () => {
    fixture.componentInstance.games.at(0).controls.spreadsheetId.setValue('sheet-a');
    fixture.componentInstance.form.controls.bahamut.controls.navigationTimeoutMs.setValue(0);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const details = element.querySelector<HTMLDetailsElement>('.form-section details');
    const timeoutInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="navigationTimeoutMs"]',
    );
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    if (!details || !timeoutInput || !downloadButton) {
      throw new Error('找不到進階設定、頁面逾時欄位或下載按鈕');
    }

    const scrollIntoView = vi.fn();
    Object.defineProperty(timeoutInput, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(timeoutInput, 'focus');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );

    expect(details.open).toBe(false);
    downloadButton.click();

    expect(details.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('downloads after every required field is valid', () => {
    fixture.componentInstance.games.at(0).controls.spreadsheetId.setValue('sheet-a');
    const createObjectURL = vi.fn(() => 'blob:config');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    fixture.componentInstance.downloadConfig();

    expect(fixture.componentInstance.issues()).toEqual([]);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:config');
    expect(fixture.componentInstance.message()).toContain('config.toml 已下載');
  });
});
