import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GuidePage } from './guide';

describe('GuidePage', () => {
  let fixture: ComponentFixture<GuidePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuidePage],
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
      expect(element.querySelector(`nav a[href="#${id}"]`)).not.toBeNull();
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
    const publicAliases = [
      'quick-start',
      'first-setup-macos',
      'first-setup-windows',
      'multiple-games-and-accounts',
      'prepare-google-sheet',
      'worksheet-date-rules',
      'share-google-sheet',
      'credentials-folder',
      'gmail-api',
      'config-reference',
      'safe-test',
      'daily-use',
      'upgrade',
      'checksums',
    ];

    for (const id of publicAliases) {
      expect(element.querySelector(`#${id}`)).not.toBeNull();
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
