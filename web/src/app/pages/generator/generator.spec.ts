import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  GENERATOR_AUTOSAVE_PREFERENCE_KEY,
  GENERATOR_DRAFT_MAX_BYTES,
  GENERATOR_DRAFT_STORAGE_KEY,
  GENERATOR_DRAFT_TTL_MS,
} from './generator-draft';
import { GeneratorPage } from './generator';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('GeneratorPage', () => {
  let fixture: ComponentFixture<GeneratorPage> | undefined;
  let storage: MemoryStorage;
  let originalLocalStorage: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  });

  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalLocalStorage);
    } else {
      Reflect.deleteProperty(window, 'localStorage');
    }
  });

  beforeEach(async () => {
    storage = new MemoryStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
    await TestBed.configureTestingModule({
      imports: [GeneratorPage],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    destroyFixture();
    storage.removeItem(GENERATOR_DRAFT_STORAGE_KEY);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createFixture(): ComponentFixture<GeneratorPage> {
    fixture = TestBed.createComponent(GeneratorPage);
    fixture.detectChanges();
    return fixture;
  }

  function destroyFixture(): void {
    fixture?.destroy();
    fixture = undefined;
  }

  it('keeps both credential fields filename-only and generates fixed safe paths', () => {
    const current = createFixture();
    const page = current.componentInstance;
    page.form.controls.gmail.controls.enabled.setValue(true);
    current.detectChanges();

    const element = current.nativeElement as HTMLElement;
    const serviceInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="serviceAccountKeyFileName"]',
    );
    const gmailInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="oauthClientSecretFileName"]',
    );
    expect(serviceInput?.closest('.form-field')?.textContent).toContain('credentials/');
    expect(gmailInput?.closest('.form-field')?.textContent).toContain('credentials/');

    page.games.at(0).controls.serviceAccountKeyFileName.setValue('account.json');
    page.form.controls.gmail.controls.oauthClientSecretFileName.setValue('oauth.json');
    expect(page.preview()).toContain('service_account_key_path = "credentials/account.json"');
    expect(page.preview()).toContain('oauth_client_secret_path = "credentials/oauth.json"');

    page.games.at(0).controls.serviceAccountKeyFileName.setValue('credentials/account.json');
    page.form.controls.gmail.controls.oauthClientSecretFileName.setValue('../oauth.json');
    expect(page.issues().map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'games.0.serviceAccountKeyFileName',
        'gmail.oauthClientSecretFileName',
      ]),
    );
  });

  it('keeps recipient synchronization correct across edits, disabled games, and removal', () => {
    const page = createFixture().componentInstance;
    const defaults = page.form.controls.gmail.controls.defaultRecipientsText;
    const first = page.games.at(0).controls;
    defaults.setValue('fallback@example.com\nOWNER@example.com');

    first.notificationRecipientsText.setValue('owner@example.com, old@example.com');
    expect(defaults.value).toBe('fallback@example.com\nOWNER@example.com\nold@example.com');

    page.addGame();
    const second = page.games.at(1).controls;
    second.notificationRecipientsText.setValue('OWNER@example.com, second@example.com');
    first.notificationRecipientsText.setValue('new@example.com');
    expect(defaults.value).toBe(
      'fallback@example.com\nOWNER@example.com\nsecond@example.com\nnew@example.com',
    );

    second.enabled.setValue(false);
    expect(defaults.value).toBe('fallback@example.com\nOWNER@example.com\nnew@example.com');
    page.removeGame(1);
    first.notificationRecipientsText.setValue('');
    expect(defaults.value).toBe('fallback@example.com\nOWNER@example.com');
  });

  it('does not move the caret while typing and restores synchronized recipients on blur', () => {
    const current = createFixture();
    const gmail = current.componentInstance.form.controls.gmail.controls;
    current.componentInstance.games
      .at(0)
      .controls.notificationRecipientsText.setValue('game@example.com');
    gmail.enabled.setValue(true);
    current.detectChanges();

    const textarea = (current.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      'textarea[formcontrolname="defaultRecipientsText"]',
    );
    if (!textarea) {
      throw new Error('找不到預設通知收件人欄位');
    }
    textarea.value = 'm';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    current.detectChanges();

    expect(gmail.defaultRecipientsText.value).toBe('m');
    expect(textarea.selectionStart).toBe(1);
    textarea.dispatchEvent(new Event('blur'));
    current.detectChanges();
    expect(gmail.defaultRecipientsText.value).toBe('m\ngame@example.com');
  });

  it('does not require unfinished fields from a disabled game', () => {
    const current = createFixture();
    const game = current.componentInstance.games.at(0).controls;
    game.gameName.setValue('');
    game.spreadsheetId.setValue('');
    game.enabled.setValue(false);
    current.detectChanges();

    const gameNameInput = (current.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[formcontrolname="gameName"]',
    );
    expect(gameNameInput?.required).toBe(false);
    expect(
      current.componentInstance.issues().filter((issue) => issue.path.startsWith('games.0')),
    ).toEqual([]);
  });

  it('blocks an invalid download and focuses the topmost field with smooth scrolling', () => {
    const current = createFixture();
    current.componentInstance.games.at(0).controls.gameName.setValue('');
    current.detectChanges();
    const element = current.nativeElement as HTMLElement;
    const gameNameInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="gameName"]',
    );
    const spreadsheetInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="spreadsheetId"]',
    );
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    if (!gameNameInput || !spreadsheetInput || !downloadButton) {
      throw new Error('找不到下載按鈕、遊戲名稱或試算表欄位');
    }
    const gameNameScrollIntoView = vi.fn();
    const spreadsheetScrollIntoView = vi.fn();
    Object.defineProperty(gameNameInput, 'scrollIntoView', {
      configurable: true,
      value: gameNameScrollIntoView,
    });
    Object.defineProperty(spreadsheetInput, 'scrollIntoView', {
      configurable: true,
      value: spreadsheetScrollIntoView,
    });
    const gameNameFocus = vi.spyOn(gameNameInput, 'focus');
    const spreadsheetFocus = vi.spyOn(spreadsheetInput, 'focus');
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadButton.click();
    current.detectChanges();

    expect(anchorClick).not.toHaveBeenCalled();
    expect(gameNameScrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(gameNameFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(spreadsheetScrollIntoView).not.toHaveBeenCalled();
    expect(spreadsheetFocus).not.toHaveBeenCalled();
    expect(gameNameInput.getAttribute('aria-invalid')).toBe('true');
    expect(spreadsheetInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('opens advanced settings and respects reduced motion before focusing an error', () => {
    const current = createFixture();
    const page = current.componentInstance;
    page.games.at(0).controls.spreadsheetId.setValue('sheet-a');
    page.form.controls.bahamut.controls.navigationTimeoutMs.setValue(0);
    current.detectChanges();

    const element = current.nativeElement as HTMLElement;
    const details = element.querySelector<HTMLDetailsElement>('.form-section details');
    const timeoutInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="navigationTimeoutMs"]',
    );
    if (!details || !timeoutInput) {
      throw new Error('找不到進階設定或頁面逾時欄位');
    }
    const scrollIntoView = vi.fn();
    Object.defineProperty(timeoutInput, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );

    page.downloadConfig();

    expect(details.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  });

  it('exports a valid config without losing the draft needed for later edits', async () => {
    const page = createFixture().componentInstance;
    page.games.at(0).controls.spreadsheetId.setValue('sheet-a');
    page.games.at(0).controls.notificationRecipientsText.setValue('game@example.com');
    page.form.controls.gmail.controls.defaultRecipientsText.setValue('');
    const createObjectURL = vi.fn(() => 'blob:config');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toBeNull();

    page.downloadConfig();

    expect(page.issues()).toEqual([]);
    expect(page.preview()).toContain('default_recipients = ["game@example.com"]');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:config');
    const savedBeforeExport = storage.getItem(GENERATOR_DRAFT_STORAGE_KEY);
    expect(savedBeforeExport).not.toBeNull();

    const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      page.games.at(0).controls.gameName.setValue('準備複製');
      window.dispatchEvent(new Event('pagehide'));
      await page.copyConfig();
      expect(writeText).toHaveBeenCalledOnce();
      expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toBeNull();

      page.games.at(0).controls.gameName.setValue('複製失敗仍須保留');
      window.dispatchEvent(new Event('pagehide'));
      writeText.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
      await page.copyConfig();
      expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toBeNull();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    }
  });

  it('restores a multi-game draft and its auto-synced recipient provenance', () => {
    const firstFixture = createFixture();
    const firstPage = firstFixture.componentInstance;
    const defaults = firstPage.form.controls.gmail.controls.defaultRecipientsText;
    defaults.setValue('manual@example.com');
    firstPage.games.at(0).controls.gameName.setValue('已填到一半');
    firstPage.games.at(0).controls.serviceAccountKeyFileName.setValue(' credentials/ABC.json ');
    firstPage.games.at(0).controls.notificationRecipientsText.setValue('old@example.com');
    firstPage.addGame();
    firstPage.games.at(1).controls.gameName.setValue('第二款遊戲');
    firstPage.games.at(1).controls.firstDataRow.setValue(null);
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toBeNull();
    destroyFixture();

    const restored = createFixture().componentInstance;
    expect(restored.games.length).toBe(2);
    expect(restored.games.at(0).controls.gameName.value).toBe('已填到一半');
    expect(restored.games.at(0).controls.serviceAccountKeyFileName.value).toBe('ABC.json');
    expect(restored.games.at(1).controls.gameName.value).toBe('第二款遊戲');
    expect(restored.games.at(1).controls.firstDataRow.value).toBeNull();
    expect(restored.draftStatus()).toContain('已恢復');

    restored.games.at(0).controls.notificationRecipientsText.setValue('new@example.com');
    expect(restored.form.controls.gmail.controls.defaultRecipientsText.value).toBe(
      'manual@example.com\nnew@example.com',
    );
  });

  it('flushes the latest edit on destroy and permanently clears local PII on request', () => {
    const firstPage = createFixture().componentInstance;
    firstPage.games.at(0).controls.gameName.setValue('離開前最後一筆');
    destroyFixture();

    const restoredFixture = createFixture();
    expect(restoredFixture.componentInstance.games.at(0).controls.gameName.value).toBe(
      '離開前最後一筆',
    );
    const text = (restoredFixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('自動保留草稿 30 天');
    expect(text).toContain('通知電子郵件');
    restoredFixture.componentInstance.setAutoSaveEnabled(false);
    destroyFixture();

    const disabledFixture = createFixture();
    expect(disabledFixture.componentInstance.autoSaveEnabled()).toBe(false);
    expect(disabledFixture.componentInstance.games.at(0).controls.gameName.value).toBe('夜鴉');
    disabledFixture.componentInstance.games.at(0).controls.gameName.setValue('不應保存');
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    disabledFixture.componentInstance.clearSavedDraft();
    expect(disabledFixture.componentInstance.autoSaveEnabled()).toBe(false);
    expect(disabledFixture.componentInstance.games.at(0).controls.gameName.value).toBe('夜鴉');
    destroyFixture();

    const reloadedDisabledFixture = createFixture();
    expect(reloadedDisabledFixture.componentInstance.autoSaveEnabled()).toBe(false);
    reloadedDisabledFixture.componentInstance.setAutoSaveEnabled(true);
    reloadedDisabledFixture.componentInstance.games.at(0).controls.gameName.setValue('可再次保存');
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toBeNull();

    reloadedDisabledFixture.componentInstance.clearSavedDraft();

    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBeNull();
    expect(reloadedDisabledFixture.componentInstance.autoSaveEnabled()).toBe(true);
    expect(reloadedDisabledFixture.componentInstance.games.length).toBe(1);
    expect(reloadedDisabledFixture.componentInstance.games.at(0).controls.gameName.value).toBe(
      '夜鴉',
    );
    destroyFixture();
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('rejects unsafe drafts and keeps working when browser storage throws', () => {
    vi.useFakeTimers();
    const original = createFixture().componentInstance;
    original.games.at(0).controls.gameName.setValue('有效草稿');
    original.games.at(0).controls.spreadsheetId.setValue('sheet-a');
    window.dispatchEvent(new Event('pagehide'));
    destroyFixture();
    const validDraft = JSON.parse(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    const validForm = structuredClone(validDraft['form']) as {
      games: Array<Record<string, unknown>>;
    };

    const unsafeDrafts = [
      '{',
      JSON.stringify({
        ...validDraft,
        updatedAt: Date.now() - GENERATOR_DRAFT_TTL_MS - 1,
      }),
      JSON.stringify({
        ...validDraft,
        form: { ...validForm, games: Array.from({ length: 21 }, () => validForm.games[0]) },
      }),
      JSON.stringify({
        ...validDraft,
        form: {
          ...validForm,
          games: [{ ...validForm.games[0], enabled: 'yes' }],
        },
      }),
      JSON.stringify({
        ...validDraft,
        form: {
          ...validForm,
          games: [{ ...validForm.games[0], gameName: 'x'.repeat(513) }],
        },
      }),
      JSON.stringify({ ...validDraft, privateKey: '不應保存的 JSON 內容' }),
      'x'.repeat(GENERATOR_DRAFT_MAX_BYTES + 1),
    ];

    for (const unsafeDraft of unsafeDrafts) {
      storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, unsafeDraft);
      const page = createFixture().componentInstance;
      expect(page.games.at(0).controls.gameName.value).toBe('夜鴉');
      expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBeNull();
      destroyFixture();
    }

    storage.setItem(
      GENERATOR_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...validDraft,
        form: {
          ...validForm,
          games: [
            {
              ...validForm.games[0],
              serviceAccountKeyFileName: '{"private_key":"secret"}',
            },
          ],
        },
      }),
    );
    const sanitizedPage = createFixture().componentInstance;
    expect(sanitizedPage.games.at(0).controls.gameName.value).toBe('有效草稿');
    expect(sanitizedPage.games.at(0).controls.serviceAccountKeyFileName.value).toBe('');
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).not.toContain('private_key');
    destroyFixture();

    const unsafeCredentialDraft = JSON.stringify({
      ...validDraft,
      form: {
        ...validForm,
        games: [
          {
            ...validForm.games[0],
            serviceAccountKeyFileName: '{"private_key":"secret"}',
          },
        ],
      },
    });
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, unsafeCredentialDraft);
    const blockedSetItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const blockedRemoveItem = vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const blockedCleanupPage = createFixture().componentInstance;
    expect(blockedCleanupPage.games.at(0).controls.gameName.value).toBe('夜鴉');
    expect(blockedCleanupPage.draftStatus()).toContain('無法清理');
    blockedSetItem.mockRestore();
    blockedRemoveItem.mockRestore();
    destroyFixture();
    storage.removeItem(GENERATOR_DRAFT_STORAGE_KEY);

    const lastKnownGood = JSON.stringify({
      ...validDraft,
      updatedAt: Date.now(),
      revision: 1,
      writerId: 'last-known-good',
    });
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, lastKnownGood);
    const current = createFixture();
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    current.componentInstance.games.at(0).controls.gameName.setValue('仍可繼續填寫');
    vi.advanceTimersByTime(250);
    expect(current.componentInstance.games.at(0).controls.gameName.value).toBe('仍可繼續填寫');
    expect(current.componentInstance.draftStatus()).toContain('無法儲存草稿');
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBe(lastKnownGood);
    setItem.mockRestore();
    destroyFixture();

    const autoSaveRemovalFailurePage = createFixture().componentInstance;
    const failedAutoSaveRemoval = vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    autoSaveRemovalFailurePage.setAutoSaveEnabled(false);
    expect(autoSaveRemovalFailurePage.draftStatus()).toContain('無法清除既有草稿');
    failedAutoSaveRemoval.mockRestore();
    storage.removeItem(GENERATOR_AUTOSAVE_PREFERENCE_KEY);
    destroyFixture();

    const manualRemovalFailurePage = createFixture().componentInstance;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const failedManualRemoval = vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    manualRemovalFailurePage.clearSavedDraft();
    expect(manualRemovalFailurePage.draftStatus()).toContain('無法清除既有草稿');
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBe(lastKnownGood);
    failedManualRemoval.mockRestore();
    destroyFixture();
    storage.removeItem(GENERATOR_DRAFT_STORAGE_KEY);

    const baseline = {
      ...validDraft,
      updatedAt: Date.now(),
      revision: 1,
      writerId: 'first-tab',
    };
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, JSON.stringify(baseline));
    const olderPage = createFixture().componentInstance;
    olderPage.games.at(0).controls.gameName.setValue('舊分頁尚未儲存');
    const newerDraft = JSON.stringify({
      ...baseline,
      updatedAt: Date.now() + 1,
      revision: 2,
      writerId: 'second-tab',
    });
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, newerDraft);
    window.dispatchEvent(new Event('pagehide'));

    expect(olderPage.draftConflict()).toBe(true);
    expect(olderPage.autoSaveEnabled()).toBe(false);
    expect(olderPage.draftStatus()).toContain('避免覆蓋');
    destroyFixture();
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBe(newerDraft);

    const watchingPage = createFixture().componentInstance;
    const newestDraft = JSON.stringify({
      ...baseline,
      updatedAt: Date.now() + 2,
      revision: 3,
      writerId: 'third-tab',
    });
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, newestDraft);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: GENERATOR_DRAFT_STORAGE_KEY,
        newValue: newestDraft,
      }),
    );
    expect(watchingPage.draftConflict()).toBe(true);
    expect(watchingPage.autoSaveEnabled()).toBe(false);
    destroyFixture();
    expect(storage.getItem(GENERATOR_DRAFT_STORAGE_KEY)).toBe(newestDraft);
  });
});
