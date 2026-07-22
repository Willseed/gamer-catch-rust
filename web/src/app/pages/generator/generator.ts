import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
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
    gameName: new FormControl(source.gameName, {
      nonNullable: true,
      validators: [Validators.required],
    }),
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
  private readonly destroyRef = inject(DestroyRef);

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

  constructor() {
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

  issueId(issue: ConfigIssue, index: number): string {
    return `${issue.path}-${index}`.replaceAll('.', '-');
  }

  async copyConfig(): Promise<void> {
    if (this.issues().length > 0) {
      this.message.set('請先修正上方提示，再複製設定檔。');
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
    if (this.issues().length > 0) {
      this.message.set('請先修正上方提示，再下載設定檔。');
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
