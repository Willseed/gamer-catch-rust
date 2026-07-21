import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GuidePage } from './guide';

describe('GuidePage', () => {
  let fixture: ComponentFixture<GuidePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuidePage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GuidePage);
    fixture.detectChanges();
  });

  it('creates the guide with all stable section fragments', () => {
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

    expect(fixture.componentInstance).toBeTruthy();
    expect(element.querySelector('h1')?.textContent).toContain('不會寫程式');
    expect(element.querySelectorAll('.guide-section')).toHaveLength(expectedIds.length);
    expect(element.querySelectorAll('[data-section-link]')).toHaveLength(expectedIds.length);

    for (const id of expectedIds) {
      expect(element.querySelector(`section#${id}`)).not.toBeNull();
      expect(element.querySelector(`nav a[href="/guide#${id}"]`)).not.toBeNull();
      expect(element.querySelector(`[data-section-link="${id}"]`)).not.toBeNull();
    }
  });

  it('covers private credentials and the requested beginner workflows', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('這個網站不收憑證');
    expect(text).toContain('Google Sheets API');
    expect(text).toContain('service account');
    expect(text).toContain('Gmail 首次授權');
    expect(text).toContain('每天 09:00 自動抓取');
    expect(text).toContain('SHA-256');
    expect(text).toContain('更換遊戲');
    expect(text).toContain('30 = 手機排行榜');
    expect(text).toContain('500 = PC 排行榜');
    expect(text).toContain('不能同時搜尋手機與 PC 排行榜');
    expect(text).toContain('同一份設定同時啟用手機與 PC');
  });

  it('uses visible button text and semantic elements for accessibility', () => {
    const element = fixture.nativeElement as HTMLElement;
    const sectionLinkButtons = element.querySelectorAll<HTMLButtonElement>('[data-section-link]');
    const tableRegions = element.querySelectorAll<HTMLElement>('.table-scroll');
    const completionMessage = element.querySelector('output.callout--success');

    for (const button of sectionLinkButtons) {
      expect(button.hasAttribute('aria-label')).toBe(false);
      expect(button.textContent?.trim()).toMatch(/^#[a-z-]+$/);
      const headingId = button.getAttribute('aria-describedby');
      expect(headingId).toBeTruthy();
      expect(element.querySelector(`#${headingId}`)).not.toBeNull();
    }

    expect(tableRegions).toHaveLength(7);
    for (const region of tableRegions) {
      expect(region.tagName).toBe('SECTION');
      expect(region.hasAttribute('tabindex')).toBe(false);
      expect(region.hasAttribute('role')).toBe(false);
    }

    expect(completionMessage).not.toBeNull();
    expect(completionMessage?.hasAttribute('role')).toBe(false);
  });

  it('keeps public deep links used by the package and website', () => {
    const element = fixture.nativeElement as HTMLElement;
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

    for (const [aliasId, sectionId] of publicAliases) {
      const alias = element.querySelector(`#${aliasId}`);
      expect(alias).not.toBeNull();
      expect(alias?.closest('.guide-section')?.id).toBe(sectionId);
    }
  });

  it('copies a canonical guide fragment URL', async () => {
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
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(
      new URL('/guide#download', window.location.origin).toString(),
    );
    expect(button?.textContent).toContain('已複製');
  });

  it('shows a clear result when clipboard access is unavailable', () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-section-link="checksum"]',
    );
    button?.click();
    fixture.detectChanges();

    expect(button?.textContent).toContain('無法複製');
  });
});
