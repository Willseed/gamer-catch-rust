import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';

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

type GameForm = ReturnType<typeof createGameForm>;

function createGameForm(index: number, source: GameSettings = createDefaultGame(index)) {
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
    firstDataRow: new FormControl(source.firstDataRow, {
      nonNullable: true,
      validators: [Validators.min(2)],
    }),
    dateColumn: new FormControl(source.dateColumn, { nonNullable: true }),
    rankColumn: new FormControl(source.rankColumn, { nonNullable: true }),
    popularityColumn: new FormControl(source.popularityColumn, { nonNullable: true }),
    notificationRecipientsText: new FormControl(source.notificationRecipients.join('\n'), {
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

  readonly maxGames = MAX_GAMES;
  readonly games = new FormArray<GameForm>([createGameForm(0)]);
  readonly form = new FormGroup({
    bahamut: new FormGroup({
      category: new FormControl(DEFAULT_BAHAMUT.category, { nonNullable: true }),
      startPage: new FormControl(DEFAULT_BAHAMUT.startPage, { nonNullable: true }),
      endPage: new FormControl(DEFAULT_BAHAMUT.endPage, { nonNullable: true }),
      navigationTimeoutMs: new FormControl(DEFAULT_BAHAMUT.navigationTimeoutMs, {
        nonNullable: true,
      }),
      pageDelayMs: new FormControl(DEFAULT_BAHAMUT.pageDelayMs, { nonNullable: true }),
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
  readonly validationAttempted = signal(false);
  private readonly autoSyncedDefaultRecipientKeys = new Set<string>();

  constructor() {
    this.games.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncGameRecipientsToDefaults());
    this.form.valueChanges
      .pipe(startWith(this.form.getRawValue()), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshOutput());
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
    const source = this.gameValue(this.games.at(index));
    source.gameName = `${source.gameName}（副本）`;
    source.writeToGoogleSheets = false;
    source.spreadsheetId = '';
    source.serviceAccountKeyFileName = `person-${this.games.length + 1}-service-account.json`;
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
      bahamut: raw.bahamut,
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
      firstDataRow: raw.firstDataRow,
      dateColumn: raw.dateColumn,
      rankColumn: raw.rankColumn,
      popularityColumn: raw.popularityColumn,
      notificationRecipients: parseRecipients(raw.notificationRecipientsText),
    };
  }
}
