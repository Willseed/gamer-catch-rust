import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SetupProgressComponent } from '../../shared/setup-progress/setup-progress';
import {
  DEFAULT_BAHAMUT,
  DEFAULT_GMAIL,
  GamerCatchConfig,
  GameSettings,
  MAX_GAMES,
  ConfigIssue,
  createDefaultGame,
  parseRecipients,
  serializeConfig,
  validateConfig,
} from '../../core/config-model';
import {
  GENERATOR_AUTOSAVE_PREFERENCE_KEY,
  GENERATOR_DRAFT_STORAGE_KEY,
  GENERATOR_DRAFT_TTL_MS,
  GeneratorDraftFormValue,
  GeneratorDraftGameValue,
  GeneratorDraftSnapshot,
  loadAutoSavePreference,
  loadGeneratorDraft,
  parseGeneratorDraftValue,
  removeGeneratorDraft,
  resolveLocalStorage,
  saveAutoSavePreference,
  saveGeneratorDraft,
} from './generator-draft';

type GameForm = ReturnType<typeof createGameForm>;
const DRAFT_SAVE_DELAY_MS = 250;
let fallbackWriterSequence = 0;

function createDraftWriterId(browserWindow: Window | null): string {
  try {
    const browserCrypto = browserWindow?.crypto;
    const writerId = browserCrypto?.randomUUID?.();
    if (writerId) {
      return writerId;
    }
    if (browserCrypto) {
      const words = browserCrypto.getRandomValues(new Uint32Array(4));
      return [...words].map((word) => word.toString(16).padStart(8, '0')).join('');
    }
  } catch {
    // This identifier coordinates tabs and is not an authentication secret.
  }
  fallbackWriterSequence += 1;
  return `writer-${Date.now()}-${fallbackWriterSequence}`;
}

function createDefaultGameFormValue(index: number): GeneratorDraftGameValue {
  const game = createDefaultGame(index);
  return {
    enabled: game.enabled,
    gameName: game.gameName,
    writeToGoogleSheets: game.writeToGoogleSheets,
    spreadsheetId: game.spreadsheetId,
    serviceAccountKeyFileName: game.serviceAccountKeyFileName,
    worksheetName: game.worksheetName,
    timezone: game.timezone,
    firstDataRow: game.firstDataRow,
    dateColumn: game.dateColumn,
    rankColumn: game.rankColumn,
    popularityColumn: game.popularityColumn,
    notificationRecipientsText: game.notificationRecipients.join('\n'),
  };
}

function createGameForm(
  index: number,
  source: GeneratorDraftGameValue = createDefaultGameFormValue(index),
) {
  return new FormGroup({
    enabled: new FormControl(source.enabled, { nonNullable: true }),
    gameName: new FormControl(source.gameName, { nonNullable: true }),
    writeToGoogleSheets: new FormControl(source.writeToGoogleSheets, { nonNullable: true }),
    spreadsheetId: new FormControl(source.spreadsheetId, { nonNullable: true }),
    serviceAccountKeyFileName: new FormControl(source.serviceAccountKeyFileName, {
      nonNullable: true,
    }),
    worksheetName: new FormControl(source.worksheetName, { nonNullable: true }),
    timezone: new FormControl(source.timezone, { nonNullable: true }),
    firstDataRow: new FormControl<number | null>(source.firstDataRow, {
      validators: [Validators.min(2)],
    }),
    dateColumn: new FormControl(source.dateColumn, { nonNullable: true }),
    rankColumn: new FormControl(source.rankColumn, { nonNullable: true }),
    popularityColumn: new FormControl(source.popularityColumn, { nonNullable: true }),
    notificationRecipientsText: new FormControl(source.notificationRecipientsText, {
      nonNullable: true,
    }),
  });
}

@Component({
  selector: 'app-generator',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, SetupProgressComponent],
  templateUrl: './generator.html',
  styleUrl: './generator.scss',
})
export class GeneratorPage {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly storage = resolveLocalStorage(this.document.defaultView);
  private readonly writerId = createDraftWriterId(this.document.defaultView);
  private readonly handlePageHide = () => this.flushDraft();
  private readonly handleVisibilityChange = () => {
    if (this.document.visibilityState === 'hidden') {
      this.flushDraft();
    }
  };
  private readonly handleStorage = (event: StorageEvent) => this.onExternalDraftChange(event);
  private draftSaveTimer: number | null = null;
  private draftDirty = false;
  private knownDraftRevision = 0;
  private knownDraftUpdatedAt = 0;
  private knownDraftWriterId = '';

  readonly maxGames = MAX_GAMES;
  readonly games = new FormArray<GameForm>([createGameForm(0)]);
  readonly form = new FormGroup({
    bahamut: new FormGroup({
      category: new FormControl<number | null>(DEFAULT_BAHAMUT.category),
      startPage: new FormControl<number | null>(DEFAULT_BAHAMUT.startPage),
      endPage: new FormControl<number | null>(DEFAULT_BAHAMUT.endPage),
      navigationTimeoutMs: new FormControl<number | null>(DEFAULT_BAHAMUT.navigationTimeoutMs),
      pageDelayMs: new FormControl<number | null>(DEFAULT_BAHAMUT.pageDelayMs),
      headless: new FormControl(DEFAULT_BAHAMUT.headless, { nonNullable: true }),
    }),
    gmail: new FormGroup({
      enabled: new FormControl(DEFAULT_GMAIL.enabled, { nonNullable: true }),
      senderEmail: new FormControl(DEFAULT_GMAIL.senderEmail, { nonNullable: true }),
      defaultRecipientsText: new FormControl('', { nonNullable: true }),
      oauthClientSecretFileName: new FormControl(DEFAULT_GMAIL.oauthClientSecretFileName, {
        nonNullable: true,
      }),
      subjectPrefix: new FormControl(DEFAULT_GMAIL.subjectPrefix, { nonNullable: true }),
    }),
    games: this.games,
  });

  readonly issues = signal<ConfigIssue[]>([]);
  readonly preview = signal('');
  readonly message = signal('');
  readonly draftStatus = signal('草稿尚未有變更。');
  readonly autoSaveEnabled = signal(loadAutoSavePreference(this.storage));
  readonly draftConflict = signal(false);
  readonly validationAttempted = signal(false);
  private readonly autoSyncedDefaultRecipientKeys = new Set<string>();

  constructor() {
    if (this.autoSaveEnabled()) {
      this.restoreDraft();
    } else {
      removeGeneratorDraft(this.storage);
      this.draftStatus.set('這台瀏覽器已關閉產生器自動儲存。');
    }
    this.games.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncGameRecipientsToDefaults());
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refreshOutput();
      this.scheduleDraftSave();
    });
    this.refreshOutput();

    const browserWindow = this.document.defaultView;
    browserWindow?.addEventListener('pagehide', this.handlePageHide);
    browserWindow?.addEventListener('storage', this.handleStorage);
    this.document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.destroyRef.onDestroy(() => {
      browserWindow?.removeEventListener('pagehide', this.handlePageHide);
      browserWindow?.removeEventListener('storage', this.handleStorage);
      this.document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.flushDraft();
    });
  }

  addGame(): void {
    if (this.games.length >= MAX_GAMES) {
      return;
    }
    this.games.push(createGameForm(this.games.length));
    this.refreshOutput();
  }

  duplicateGame(index: number): void {
    if (this.games.length >= MAX_GAMES) {
      return;
    }
    const current = this.games.at(index).getRawValue();
    const source: GeneratorDraftGameValue = {
      ...current,
      gameName: `${current.gameName}（副本）`,
      writeToGoogleSheets: false,
      spreadsheetId: '',
      serviceAccountKeyFileName: `person-${this.games.length + 1}-service-account.json`,
    };
    this.games.push(createGameForm(this.games.length, source));
    this.refreshOutput();
  }

  removeGame(index: number): void {
    if (this.games.length === 1) {
      return;
    }
    this.games.removeAt(index);
    this.refreshOutput();
  }

  syncDefaultRecipientsOnBlur(): void {
    this.syncGameRecipientsToDefaults();
  }

  setAutoSaveEnabled(enabled: boolean): void {
    if (this.draftConflict()) {
      return;
    }
    this.autoSaveEnabled.set(enabled);
    const preferenceSaved = saveAutoSavePreference(this.storage, enabled);
    if (!enabled) {
      this.clearDraftTimer();
      this.draftDirty = false;
      const draftRemoved = removeGeneratorDraft(this.storage);
      this.resetKnownDraftMetadata();
      if (!draftRemoved) {
        this.draftStatus.set(
          '已停止本頁自動儲存，但瀏覽器無法清除既有草稿；請從瀏覽器設定清除本站資料。',
        );
      } else if (!preferenceSaved) {
        this.draftStatus.set(
          '已清除草稿並停止本頁自動儲存，但瀏覽器無法記住此選擇；下次開啟時請再次確認。',
        );
      } else {
        this.draftStatus.set('已關閉自動儲存，並清除這台瀏覽器中的草稿。');
      }
      return;
    }
    this.draftDirty = true;
    this.scheduleDraftSave();
    this.draftStatus.set(
      preferenceSaved ? '已開啟自動儲存。' : '已開啟本頁自動儲存，但瀏覽器無法記住此選擇。',
    );
  }

  clearSavedDraft(): void {
    const browserWindow = this.document.defaultView;
    const confirmation = this.draftConflict()
      ? '另一個分頁有較新的草稿。仍要刪除該草稿，並把這一頁恢復為預設值嗎？'
      : '要清除這台瀏覽器中的草稿，並把產生器恢復為預設值嗎？';
    if (browserWindow && !browserWindow.confirm(confirmation)) {
      return;
    }

    this.clearDraftTimer();
    this.draftDirty = false;
    this.autoSaveEnabled.set(loadAutoSavePreference(this.storage));
    this.draftConflict.set(false);
    this.resetKnownDraftMetadata();
    this.autoSyncedDefaultRecipientKeys.clear();
    this.games.clear({ emitEvent: false });
    this.games.push(createGameForm(0), { emitEvent: false });
    this.form.controls.bahamut.reset(
      {
        category: DEFAULT_BAHAMUT.category,
        startPage: DEFAULT_BAHAMUT.startPage,
        endPage: DEFAULT_BAHAMUT.endPage,
        navigationTimeoutMs: DEFAULT_BAHAMUT.navigationTimeoutMs,
        pageDelayMs: DEFAULT_BAHAMUT.pageDelayMs,
        headless: DEFAULT_BAHAMUT.headless,
      },
      { emitEvent: false },
    );
    this.form.controls.gmail.reset(
      {
        enabled: DEFAULT_GMAIL.enabled,
        senderEmail: DEFAULT_GMAIL.senderEmail,
        defaultRecipientsText: '',
        oauthClientSecretFileName: DEFAULT_GMAIL.oauthClientSecretFileName,
        subjectPrefix: DEFAULT_GMAIL.subjectPrefix,
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.validationAttempted.set(false);
    this.refreshOutput();
    const draftRemoved = removeGeneratorDraft(this.storage);
    this.draftStatus.set(
      draftRemoved
        ? '已清除這台瀏覽器中的草稿。'
        : '已重設目前表單，但瀏覽器無法清除既有草稿；請從瀏覽器設定清除本站資料。',
    );
    this.message.set(
      draftRemoved ? '已恢復產生器預設值。' : '目前表單已恢復預設值，但本機草稿可能仍存在。',
    );
  }

  issueId(issue: ConfigIssue, index: number): string {
    return `${issue.path}-${index}`.replaceAll('.', '-');
  }

  isInvalidField(path: string): boolean {
    return (
      this.validationAttempted() &&
      this.issues().some((issue) => this.issueTargetPath(issue.path) === path)
    );
  }

  async copyConfig(): Promise<void> {
    if (!this.validateForExport('複製')) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.preview());
      this.message.set('已複製 config.toml 內容。');
    } catch {
      this.message.set('瀏覽器無法自動複製，請在下方預覽區全選後複製。');
    }
  }

  downloadConfig(): void {
    if (!this.validateForExport('下載')) {
      return;
    }
    const blob = new Blob([this.preview()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'config.toml';
    anchor.click();
    URL.revokeObjectURL(url);
    this.message.set('config.toml 已下載。請放到 GamerCatch 資料夾最外層。');
  }

  private refreshOutput(): void {
    const config = this.toConfig();
    this.issues.set(validateConfig(config));
    this.preview.set(serializeConfig(config));
    this.message.set('');
  }

  private restoreDraft(): void {
    const draft = loadGeneratorDraft(this.storage, Date.now(), () => {
      this.draftStatus.set(
        '瀏覽器無法清理不安全或損壞的草稿，已停止恢復；請從瀏覽器設定清除本站資料。',
      );
    });
    if (!draft) {
      return;
    }

    this.games.clear({ emitEvent: false });
    draft.form.games.forEach((game, index) => {
      this.games.push(createGameForm(index, game), { emitEvent: false });
    });
    this.form.controls.bahamut.setValue(draft.form.bahamut, { emitEvent: false });
    this.form.controls.gmail.setValue(draft.form.gmail, { emitEvent: false });

    const defaultRecipientKeys = new Set(
      parseRecipients(draft.form.gmail.defaultRecipientsText).map((recipient) =>
        this.recipientKey(recipient),
      ),
    );
    const gameRecipientKeys = new Set(
      draft.form.games.flatMap((game) =>
        game.enabled
          ? parseRecipients(game.notificationRecipientsText).map((recipient) =>
              this.recipientKey(recipient),
            )
          : [],
      ),
    );
    for (const key of draft.autoSyncedDefaultRecipientKeys) {
      if (defaultRecipientKeys.has(key) && gameRecipientKeys.has(key)) {
        this.autoSyncedDefaultRecipientKeys.add(key);
      }
    }
    this.knownDraftRevision = draft.revision;
    this.knownDraftUpdatedAt = draft.updatedAt;
    this.knownDraftWriterId = draft.writerId;
    this.form.markAsPristine();
    this.draftStatus.set('已恢復這台瀏覽器先前儲存的草稿。');
  }

  private scheduleDraftSave(): void {
    if (!this.autoSaveEnabled() || this.draftConflict()) {
      return;
    }
    this.draftDirty = true;
    this.clearDraftTimer();
    const browserWindow = this.document.defaultView;
    if (!browserWindow) {
      this.flushDraft();
      return;
    }
    this.draftSaveTimer = browserWindow.setTimeout(() => this.flushDraft(), DRAFT_SAVE_DELAY_MS);
  }

  private flushDraft(): void {
    if (!this.draftDirty || !this.autoSaveEnabled() || this.draftConflict()) {
      return;
    }
    this.clearDraftTimer();
    const storedDraft = loadGeneratorDraft(this.storage);
    if (this.hasExternalDraftChange(storedDraft)) {
      this.markDraftConflict();
      return;
    }

    this.draftDirty = false;
    const updatedAt = Date.now();
    const revision = this.knownDraftRevision + 1;
    const saved = saveGeneratorDraft(
      this.storage,
      this.draftFormValue(),
      [...this.autoSyncedDefaultRecipientKeys],
      {
        updatedAt,
        revision,
        writerId: this.writerId,
      },
    );
    if (saved) {
      this.knownDraftRevision = revision;
      this.knownDraftUpdatedAt = updatedAt;
      this.knownDraftWriterId = this.writerId;
    }
    this.draftStatus.set(
      saved ? '已自動儲存於這台瀏覽器。' : '瀏覽器無法儲存草稿；離開前請先下載設定檔。',
    );
  }

  private onExternalDraftChange(event: StorageEvent): void {
    if (event.storageArea !== null && event.storageArea !== this.storage) {
      return;
    }
    if (event.key === GENERATOR_AUTOSAVE_PREFERENCE_KEY) {
      const enabled = loadAutoSavePreference(this.storage);
      this.autoSaveEnabled.set(enabled);
      if (!enabled) {
        this.clearDraftTimer();
        this.draftDirty = false;
        this.draftStatus.set('另一個分頁已關閉產生器自動儲存。');
      } else if (!this.draftConflict()) {
        this.draftStatus.set('另一個分頁已開啟產生器自動儲存。');
      }
      return;
    }
    if (event.key !== GENERATOR_DRAFT_STORAGE_KEY) {
      return;
    }
    if (event.newValue === null) {
      if (!this.autoSaveEnabled()) {
        this.resetKnownDraftMetadata();
        return;
      }
      if (this.knownDraftRevision > 0 || this.draftDirty) {
        this.markDraftConflict();
      }
      return;
    }
    const draft = parseGeneratorDraftValue(event.newValue);
    if (!draft || this.hasExternalDraftChange(draft)) {
      this.markDraftConflict();
    }
  }

  private hasExternalDraftChange(draft: GeneratorDraftSnapshot | null): boolean {
    if (!draft) {
      if (
        this.knownDraftRevision > 0 &&
        Date.now() - this.knownDraftUpdatedAt > GENERATOR_DRAFT_TTL_MS
      ) {
        this.resetKnownDraftMetadata();
        return false;
      }
      return this.knownDraftRevision > 0;
    }
    if (draft.writerId === this.writerId) {
      return false;
    }
    return (
      draft.revision > this.knownDraftRevision ||
      draft.updatedAt > this.knownDraftUpdatedAt ||
      (draft.revision === this.knownDraftRevision &&
        draft.updatedAt === this.knownDraftUpdatedAt &&
        draft.writerId !== this.knownDraftWriterId)
    );
  }

  private markDraftConflict(): void {
    this.clearDraftTimer();
    this.autoSaveEnabled.set(false);
    this.draftConflict.set(true);
    this.draftStatus.set('另一個分頁已有較新的草稿。為避免覆蓋，自動儲存已停止；請重新載入此頁。');
  }

  private resetKnownDraftMetadata(): void {
    this.knownDraftRevision = 0;
    this.knownDraftUpdatedAt = 0;
    this.knownDraftWriterId = '';
  }

  private clearDraftTimer(): void {
    if (this.draftSaveTimer === null) {
      return;
    }
    this.document.defaultView?.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = null;
  }

  private draftFormValue(): GeneratorDraftFormValue {
    const raw = this.form.getRawValue();
    return {
      bahamut: {
        category: raw.bahamut.category,
        startPage: raw.bahamut.startPage,
        endPage: raw.bahamut.endPage,
        navigationTimeoutMs: raw.bahamut.navigationTimeoutMs,
        pageDelayMs: raw.bahamut.pageDelayMs,
        headless: raw.bahamut.headless,
      },
      gmail: {
        enabled: raw.gmail.enabled,
        senderEmail: raw.gmail.senderEmail,
        defaultRecipientsText: raw.gmail.defaultRecipientsText,
        oauthClientSecretFileName: raw.gmail.oauthClientSecretFileName,
        subjectPrefix: raw.gmail.subjectPrefix,
      },
      games: this.games.controls.map((game) => {
        const value = game.getRawValue();
        return {
          enabled: value.enabled,
          gameName: value.gameName,
          writeToGoogleSheets: value.writeToGoogleSheets,
          spreadsheetId: value.spreadsheetId,
          serviceAccountKeyFileName: value.serviceAccountKeyFileName,
          worksheetName: value.worksheetName,
          timezone: value.timezone,
          firstDataRow: value.firstDataRow,
          dateColumn: value.dateColumn,
          rankColumn: value.rankColumn,
          popularityColumn: value.popularityColumn,
          notificationRecipientsText: value.notificationRecipientsText,
        };
      }),
    };
  }

  private syncGameRecipientsToDefaults(): void {
    const defaultControl = this.form.controls.gmail.controls.defaultRecipientsText;
    const currentDefaults = parseRecipients(defaultControl.value);
    const gameRecipients = this.games.controls.flatMap((game) =>
      game.controls.enabled.value
        ? parseRecipients(game.controls.notificationRecipientsText.value)
        : [],
    );
    const desiredKeys = new Set(gameRecipients.map((recipient) => this.recipientKey(recipient)));
    const nextAutoSyncedKeys = new Set<string>();
    let changed = false;

    const nextDefaults = currentDefaults.filter((recipient) => {
      const key = this.recipientKey(recipient);
      if (this.autoSyncedDefaultRecipientKeys.has(key) && !desiredKeys.has(key)) {
        changed = true;
        return false;
      }
      if (this.autoSyncedDefaultRecipientKeys.has(key)) {
        nextAutoSyncedKeys.add(key);
      }
      return true;
    });
    const presentKeys = new Set(nextDefaults.map((recipient) => this.recipientKey(recipient)));

    for (const recipient of gameRecipients) {
      const key = this.recipientKey(recipient);
      if (presentKeys.has(key)) {
        continue;
      }
      nextDefaults.push(recipient);
      presentKeys.add(key);
      nextAutoSyncedKeys.add(key);
      changed = true;
    }

    this.autoSyncedDefaultRecipientKeys.clear();
    nextAutoSyncedKeys.forEach((key) => this.autoSyncedDefaultRecipientKeys.add(key));
    if (changed) {
      defaultControl.setValue(nextDefaults.join('\n'));
    }
  }

  private recipientKey(recipient: string): string {
    return recipient.toLocaleLowerCase('en-US');
  }

  private validateForExport(action: '下載' | '複製'): boolean {
    this.syncGameRecipientsToDefaults();
    const config = this.toConfig();
    const issues = validateConfig(config);
    this.form.markAllAsTouched();
    this.issues.set(issues);
    this.preview.set(serializeConfig(config));

    if (issues.length === 0) {
      this.validationAttempted.set(false);
      return true;
    }

    this.validationAttempted.set(true);
    const firstIssue = this.focusFirstIssue(issues);
    const guidance = `請先完成所有必填欄位並修正標示內容，再${action}設定檔。`;
    this.message.set(firstIssue ? `${firstIssue.message} ${guidance}` : guidance);
    return false;
  }

  private focusFirstIssue(issues: ConfigIssue[]): ConfigIssue | undefined {
    const targetPaths = new Set(issues.map((issue) => this.issueTargetPath(issue.path)));
    const target = Array.from(
      this.hostElement.nativeElement.querySelectorAll<HTMLElement>('[data-config-path]'),
    ).find((element) => targetPaths.has(element.dataset['configPath'] ?? ''));

    if (!target) {
      return undefined;
    }

    const details = target.closest<HTMLDetailsElement>('details');
    if (details) {
      details.open = true;
    }

    const prefersReducedMotion =
      this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
    });
    target.focus({ preventScroll: true });

    const targetPath = target.dataset['configPath'];
    return issues.find((issue) => this.issueTargetPath(issue.path) === targetPath);
  }

  private issueTargetPath(path: string): string {
    if (path === 'games') {
      return 'games.0.enabled';
    }
    if (path === 'gmail.recipients') {
      return 'gmail.defaultRecipients';
    }

    const gameColumns = /^games\.(\d+)\.columns$/u.exec(path);
    if (gameColumns) {
      return `games.${gameColumns[1]}.dateColumn`;
    }

    return path;
  }

  private toConfig(): GamerCatchConfig {
    const raw = this.form.getRawValue();
    return {
      bahamut: {
        category: raw.bahamut.category ?? Number.NaN,
        startPage: raw.bahamut.startPage ?? Number.NaN,
        endPage: raw.bahamut.endPage ?? Number.NaN,
        navigationTimeoutMs: raw.bahamut.navigationTimeoutMs ?? Number.NaN,
        pageDelayMs: raw.bahamut.pageDelayMs ?? Number.NaN,
        headless: raw.bahamut.headless,
      },
      gmail: {
        enabled: raw.gmail.enabled,
        senderEmail: raw.gmail.senderEmail,
        defaultRecipients: parseRecipients(raw.gmail.defaultRecipientsText),
        oauthClientSecretFileName: raw.gmail.oauthClientSecretFileName,
        subjectPrefix: raw.gmail.subjectPrefix,
      },
      games: this.games.controls.map((control) => this.gameValue(control)),
    };
  }

  private gameValue(control: GameForm): GameSettings {
    const raw = control.getRawValue();
    return {
      enabled: raw.enabled,
      gameName: raw.gameName,
      writeToGoogleSheets: raw.writeToGoogleSheets,
      spreadsheetId: raw.spreadsheetId,
      serviceAccountKeyFileName: raw.serviceAccountKeyFileName,
      worksheetName: raw.worksheetName,
      timezone: raw.timezone,
      firstDataRow: raw.firstDataRow ?? Number.NaN,
      dateColumn: raw.dateColumn,
      rankColumn: raw.rankColumn,
      popularityColumn: raw.popularityColumn,
      notificationRecipients: parseRecipients(raw.notificationRecipientsText),
    };
  }
}
