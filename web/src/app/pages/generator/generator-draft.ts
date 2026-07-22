import { MAX_GAMES } from '../../core/config-model';

export const GENERATOR_DRAFT_STORAGE_KEY = 'gamercatch.generator-draft.v1';
export const GENERATOR_AUTOSAVE_PREFERENCE_KEY = 'gamercatch.generator-autosave.v1';
export const GENERATOR_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const GENERATOR_DRAFT_MAX_BYTES = 64 * 1_024;

const DRAFT_VERSION = 1;
const MAX_RECIPIENT_TEXT_LENGTH = 16_384;
const MAX_AUTO_SYNCED_RECIPIENTS = 1_000;
const MAX_AUTO_SYNCED_RECIPIENT_LENGTH = 2_048;

export interface GeneratorDraftBahamutValue {
  readonly category: number | null;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly navigationTimeoutMs: number | null;
  readonly pageDelayMs: number | null;
  readonly headless: boolean;
}

export interface GeneratorDraftGmailValue {
  readonly enabled: boolean;
  readonly senderEmail: string;
  readonly defaultRecipientsText: string;
  readonly oauthClientSecretFileName: string;
  readonly subjectPrefix: string;
}

export interface GeneratorDraftGameValue {
  readonly enabled: boolean;
  readonly gameName: string;
  readonly writeToGoogleSheets: boolean;
  readonly spreadsheetId: string;
  readonly serviceAccountKeyFileName: string;
  readonly worksheetName: string;
  readonly timezone: string;
  readonly firstDataRow: number | null;
  readonly dateColumn: string;
  readonly rankColumn: string;
  readonly popularityColumn: string;
  readonly notificationRecipientsText: string;
}

export interface GeneratorDraftFormValue {
  readonly bahamut: GeneratorDraftBahamutValue;
  readonly gmail: GeneratorDraftGmailValue;
  readonly games: readonly GeneratorDraftGameValue[];
}

export interface GeneratorDraftSnapshot {
  readonly form: GeneratorDraftFormValue;
  readonly autoSyncedDefaultRecipientKeys: readonly string[];
  readonly updatedAt: number;
  readonly revision: number;
  readonly writerId: string;
}

export interface GeneratorDraftWriteMetadata {
  readonly updatedAt: number;
  readonly revision: number;
  readonly writerId: string;
}

interface StoredGeneratorDraft extends GeneratorDraftSnapshot {
  readonly version: typeof DRAFT_VERSION;
}

export function resolveLocalStorage(browserWindow: Window | null): Storage | null {
  try {
    return browserWindow?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadAutoSavePreference(storage: Storage | null): boolean {
  if (!storage) {
    return true;
  }
  try {
    const value = storage.getItem(GENERATOR_AUTOSAVE_PREFERENCE_KEY);
    if (value === null || value === 'enabled') {
      return true;
    }
    if (value === 'disabled') {
      return false;
    }
    storage.removeItem(GENERATOR_AUTOSAVE_PREFERENCE_KEY);
    return true;
  } catch {
    return true;
  }
}

export function saveAutoSavePreference(storage: Storage | null, enabled: boolean): boolean {
  if (!storage) {
    return false;
  }
  try {
    if (enabled) {
      storage.removeItem(GENERATOR_AUTOSAVE_PREFERENCE_KEY);
    } else {
      storage.setItem(GENERATOR_AUTOSAVE_PREFERENCE_KEY, 'disabled');
    }
    return true;
  } catch {
    return false;
  }
}

export function loadGeneratorDraft(
  storage: Storage | null,
  now = Date.now(),
  onCleanupFailure?: () => void,
): GeneratorDraftSnapshot | null {
  if (!storage) {
    return null;
  }

  let serialized: string | null;
  try {
    serialized = storage.getItem(GENERATOR_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (serialized === null) {
    return null;
  }
  const draft = parseGeneratorDraftValue(serialized, now);
  if (!draft) {
    if (!removeGeneratorDraft(storage)) {
      onCleanupFailure?.();
    }
    return null;
  }

  const canonicalDraft = JSON.stringify({
    version: DRAFT_VERSION,
    form: draft.form,
    autoSyncedDefaultRecipientKeys: draft.autoSyncedDefaultRecipientKeys,
    updatedAt: draft.updatedAt,
    revision: draft.revision,
    writerId: draft.writerId,
  });
  if (canonicalDraft !== serialized) {
    try {
      storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, canonicalDraft);
    } catch {
      if (!removeGeneratorDraft(storage)) {
        onCleanupFailure?.();
        return null;
      }
    }
  }

  return draft;
}

export function parseGeneratorDraftValue(
  serialized: string,
  now = Date.now(),
): GeneratorDraftSnapshot | null {
  if (
    serialized.length > GENERATOR_DRAFT_MAX_BYTES ||
    utf8ByteLength(serialized) > GENERATOR_DRAFT_MAX_BYTES
  ) {
    return null;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
  const draft = parseStoredDraft(candidate, now);
  if (!draft) {
    return null;
  }

  return {
    form: draft.form,
    autoSyncedDefaultRecipientKeys: draft.autoSyncedDefaultRecipientKeys,
    updatedAt: draft.updatedAt,
    revision: draft.revision,
    writerId: draft.writerId,
  };
}

export function saveGeneratorDraft(
  storage: Storage | null,
  form: GeneratorDraftFormValue,
  autoSyncedDefaultRecipientKeys: readonly string[],
  metadata: GeneratorDraftWriteMetadata,
): boolean {
  if (!storage) {
    return false;
  }

  const safeForm = parseDraftForm(form);
  const safeKeys = parseAutoSyncedRecipientKeys(autoSyncedDefaultRecipientKeys);
  if (!safeForm || !safeKeys || !isValidMetadata(metadata)) {
    return false;
  }

  const draft: StoredGeneratorDraft = {
    version: DRAFT_VERSION,
    form: safeForm,
    autoSyncedDefaultRecipientKeys: safeKeys,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    writerId: metadata.writerId,
  };
  const serialized = JSON.stringify(draft);
  if (
    serialized.length > GENERATOR_DRAFT_MAX_BYTES ||
    utf8ByteLength(serialized) > GENERATOR_DRAFT_MAX_BYTES
  ) {
    return false;
  }

  try {
    storage.setItem(GENERATOR_DRAFT_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function removeGeneratorDraft(storage: Storage | null): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(GENERATOR_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function parseStoredDraft(candidate: unknown, now: number): StoredGeneratorDraft | null {
  if (
    !isRecord(candidate) ||
    !hasOnlyKeys(candidate, [
      'version',
      'form',
      'autoSyncedDefaultRecipientKeys',
      'updatedAt',
      'revision',
      'writerId',
    ]) ||
    candidate['version'] !== DRAFT_VERSION
  ) {
    return null;
  }
  const metadata = {
    updatedAt: candidate['updatedAt'],
    revision: candidate['revision'],
    writerId: candidate['writerId'],
  };
  if (!isValidMetadata(metadata, now)) {
    return null;
  }
  const form = parseDraftForm(candidate['form']);
  const autoSyncedDefaultRecipientKeys = parseAutoSyncedRecipientKeys(
    candidate['autoSyncedDefaultRecipientKeys'],
  );
  if (!form || !autoSyncedDefaultRecipientKeys) {
    return null;
  }
  return {
    version: DRAFT_VERSION,
    form,
    autoSyncedDefaultRecipientKeys,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    writerId: metadata.writerId,
  };
}

function parseDraftForm(candidate: unknown): GeneratorDraftFormValue | null {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['bahamut', 'gmail', 'games'])) {
    return null;
  }
  const bahamut = parseBahamut(candidate['bahamut']);
  const gmail = parseGmail(candidate['gmail']);
  const gamesCandidate = candidate['games'];
  if (
    !bahamut ||
    !gmail ||
    !Array.isArray(gamesCandidate) ||
    gamesCandidate.length < 1 ||
    gamesCandidate.length > MAX_GAMES
  ) {
    return null;
  }
  const games: GeneratorDraftGameValue[] = [];
  for (const gameCandidate of gamesCandidate) {
    const game = parseGame(gameCandidate);
    if (!game) {
      return null;
    }
    games.push(game);
  }
  return { bahamut, gmail, games };
}

function parseBahamut(candidate: unknown): GeneratorDraftBahamutValue | null {
  if (
    !isRecord(candidate) ||
    !hasOnlyKeys(candidate, [
      'category',
      'startPage',
      'endPage',
      'navigationTimeoutMs',
      'pageDelayMs',
      'headless',
    ])
  ) {
    return null;
  }
  const category = candidate['category'];
  const startPage = candidate['startPage'];
  const endPage = candidate['endPage'];
  const navigationTimeoutMs = candidate['navigationTimeoutMs'];
  const pageDelayMs = candidate['pageDelayMs'];
  const headless = candidate['headless'];
  if (
    !isDraftNumber(category) ||
    !isDraftNumber(startPage) ||
    !isDraftNumber(endPage) ||
    !isDraftNumber(navigationTimeoutMs) ||
    !isDraftNumber(pageDelayMs) ||
    typeof headless !== 'boolean'
  ) {
    return null;
  }
  return { category, startPage, endPage, navigationTimeoutMs, pageDelayMs, headless };
}

function parseGmail(candidate: unknown): GeneratorDraftGmailValue | null {
  if (
    !isRecord(candidate) ||
    !hasOnlyKeys(candidate, [
      'enabled',
      'senderEmail',
      'defaultRecipientsText',
      'oauthClientSecretFileName',
      'subjectPrefix',
    ])
  ) {
    return null;
  }
  const enabled = candidate['enabled'];
  const senderEmail = candidate['senderEmail'];
  const defaultRecipientsText = candidate['defaultRecipientsText'];
  const oauthClientSecretFileName = parseCredentialDraftValue(
    candidate['oauthClientSecretFileName'],
  );
  const subjectPrefix = candidate['subjectPrefix'];
  if (
    typeof enabled !== 'boolean' ||
    !isLimitedString(senderEmail, 254) ||
    !isLimitedString(defaultRecipientsText, MAX_RECIPIENT_TEXT_LENGTH) ||
    oauthClientSecretFileName === null ||
    !isLimitedString(subjectPrefix, 60)
  ) {
    return null;
  }
  return {
    enabled,
    senderEmail,
    defaultRecipientsText,
    oauthClientSecretFileName,
    subjectPrefix,
  };
}

function parseGame(candidate: unknown): GeneratorDraftGameValue | null {
  if (
    !isRecord(candidate) ||
    !hasOnlyKeys(candidate, [
      'enabled',
      'gameName',
      'writeToGoogleSheets',
      'spreadsheetId',
      'serviceAccountKeyFileName',
      'worksheetName',
      'timezone',
      'firstDataRow',
      'dateColumn',
      'rankColumn',
      'popularityColumn',
      'notificationRecipientsText',
    ])
  ) {
    return null;
  }
  const enabled = candidate['enabled'];
  const gameName = candidate['gameName'];
  const writeToGoogleSheets = candidate['writeToGoogleSheets'];
  const spreadsheetId = candidate['spreadsheetId'];
  const serviceAccountKeyFileName = parseCredentialDraftValue(
    candidate['serviceAccountKeyFileName'],
  );
  const worksheetName = candidate['worksheetName'];
  const timezone = candidate['timezone'];
  const firstDataRow = candidate['firstDataRow'];
  const dateColumn = candidate['dateColumn'];
  const rankColumn = candidate['rankColumn'];
  const popularityColumn = candidate['popularityColumn'];
  const notificationRecipientsText = candidate['notificationRecipientsText'];
  if (
    typeof enabled !== 'boolean' ||
    !isLimitedString(gameName, 512) ||
    typeof writeToGoogleSheets !== 'boolean' ||
    !isLimitedString(spreadsheetId, 2_048) ||
    serviceAccountKeyFileName === null ||
    !isLimitedString(worksheetName, 512) ||
    !isLimitedString(timezone, 64) ||
    !isDraftNumber(firstDataRow) ||
    !isLimitedString(dateColumn, 3) ||
    !isLimitedString(rankColumn, 3) ||
    !isLimitedString(popularityColumn, 3) ||
    !isLimitedString(notificationRecipientsText, MAX_RECIPIENT_TEXT_LENGTH)
  ) {
    return null;
  }
  return {
    enabled,
    gameName,
    writeToGoogleSheets,
    spreadsheetId,
    serviceAccountKeyFileName,
    worksheetName,
    timezone,
    firstDataRow,
    dateColumn,
    rankColumn,
    popularityColumn,
    notificationRecipientsText,
  };
}

function parseAutoSyncedRecipientKeys(candidate: unknown): string[] | null {
  if (!Array.isArray(candidate) || candidate.length > MAX_AUTO_SYNCED_RECIPIENTS) {
    return null;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const keyCandidate of candidate) {
    if (!isLimitedString(keyCandidate, MAX_AUTO_SYNCED_RECIPIENT_LENGTH)) {
      return null;
    }
    const key = keyCandidate.toLocaleLowerCase('en-US');
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLimitedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isDraftNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function parseCredentialDraftValue(value: unknown): string | null {
  if (!isLimitedString(value, 255)) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || /[/\\]$/u.test(trimmed)) {
    return '';
  }
  const fileName = trimmed.split(/[/\\]/u).at(-1) ?? '';
  if (fileName === '.' || fileName === '..' || /[<>:"|?*\u0000-\u001f\u007f]/u.test(fileName)) {
    return '';
  }
  return fileName;
}

function isValidMetadata(
  value: {
    readonly updatedAt: unknown;
    readonly revision: unknown;
    readonly writerId: unknown;
  },
  now = Date.now(),
): value is GeneratorDraftWriteMetadata {
  return (
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0 &&
    value.updatedAt <= now + 5 * 60 * 1_000 &&
    now - value.updatedAt <= GENERATOR_DRAFT_TTL_MS &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    isLimitedString(value.writerId, 128) &&
    value.writerId.length > 0
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
