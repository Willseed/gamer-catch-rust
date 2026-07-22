import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GuidePage } from './guide';

describe('GuidePage high-risk contracts', () => {
  let fixture: ComponentFixture<GuidePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuidePage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GuidePage);
    fixture.detectChanges();
  });

  it('keeps every canonical section and public package deep-link alias reachable', () => {
    const element = fixture.nativeElement as HTMLElement;
    const expectedIds = [
      'download',
      'system-safety',
      'multiple-games-accounts',
      'prepare-sheets',
      'google-sheets-api',
      'service-account',
      'share-sheets',
      'credentials',
      'gmail-oauth',
      'gmail-authorization',
      'gmail-notifications',
      'config-generator',
      'config-fields',
      'multiple-game-config',
      'dry-run',
      'production-run',
      'windows-scheduled-task',
      'change-game',
      'troubleshooting',
      'security',
      'update',
      'checksum',
      'checklist',
    ];
    const publicAliases = new Map([
      ['quick-start', 'system-safety'],
      ['first-setup-macos', 'system-safety'],
      ['first-setup-windows', 'system-safety'],
      ['multiple-games-and-accounts', 'multiple-games-accounts'],
      ['prepare-google-sheet', 'prepare-sheets'],
      ['worksheet-date-rules', 'prepare-sheets'],
      ['share-google-sheet', 'share-sheets'],
      ['credentials-folder', 'credentials'],
      ['gmail-api', 'gmail-oauth'],
      ['config-reference', 'config-fields'],
      ['safe-test', 'dry-run'],
      ['daily-use', 'production-run'],
      ['upgrade', 'update'],
      ['checksums', 'checksum'],
    ]);

    expect(element.querySelectorAll('.guide-section')).toHaveLength(expectedIds.length);
    for (const id of expectedIds) {
      expect(element.querySelector(`section#${id}`), id).not.toBeNull();
      expect(element.querySelector(`nav a[href="/guide#${id}"]`), id).not.toBeNull();
      expect(element.querySelector(`[data-section-link="${id}"]`), id).not.toBeNull();
    }
    for (const [aliasId, sectionId] of publicAliases) {
      expect(element.querySelector(`#${aliasId}`)?.closest('.guide-section')?.id, aliasId).toBe(
        sectionId,
      );
    }
  });

  it('preserves the beginner flow and its credential, category, and Gmail safety contracts', () => {
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';
    const heroSteps = element.querySelectorAll('.hero__steps > li');
    const firstSetupText = element
      .querySelector('#system-safety')
      ?.textContent?.replace(/\s+/gu, ' ');
    const gmailSection = element.querySelector('#gmail-oauth');
    const gmailText = gmailSection?.textContent?.replace(/\s+/gu, ' ') ?? '';

    expect([...heroSteps].map((step) => step.textContent?.replace(/\s+/gu, ' ').trim())).toEqual([
      '1下載並解壓縮',
      '2準備 Google 並產生設定',
      '3下載 config.toml 並放好',
    ]);
    expect(element.querySelector('#config-placement')?.closest('.guide-section')?.id).toBe(
      'config-generator',
    );
    expect(firstSetupText).toContain('不會打開或修改 config.toml');
    expect(text).toContain('這個網站不收憑證');
    expect(text).toContain('不能同時搜尋手機與 PC 排行榜');

    expect(gmailText).toContain('Desktop app（電腦版應用程式）');
    expect(gmailText).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(gmailText).toContain('External Testing 已把該帳號加入 Test users');
    expect(gmailText).toContain('credentials/gmail-oauth-client.json');
    expect(gmailText).toContain('refresh token 通常會在 7 天後失效');
    expect(
      gmailSection?.querySelector('a[href="/guide#gmail-authorization"]')?.textContent,
    ).toContain('完成 Gmail 首次授權');
  });

  it('copies a canonical fragment URL instead of a transient or aliased location', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-section-link="download"]',
    );
    button?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(
      new URL('/guide#download', window.location.origin).toString(),
    );
  });
});
