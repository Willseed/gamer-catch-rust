import { DOCUMENT } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { detectDownloadPlatform, DownloadsPage } from './downloads';

describe('DownloadsPage high-risk contracts', () => {
  let fixture: ComponentFixture<DownloadsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DownloadsPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadsPage);
    fixture.detectChanges();
    fixture.componentInstance.detectedPlatform.set('windows');
    fixture.componentInstance.dismissSupportToast();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects supported desktops while rejecting Linux, mobile, iPad, ChromeOS, and missing data', () => {
    const cases = [
      [{ userAgentData: { platform: 'Windows' }, userAgent: '' }, 'windows'],
      [{ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }, 'macos'],
      [{ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 'linux'],
      [
        { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile' },
        'unsupported',
      ],
      [
        {
          maxTouchPoints: 5,
          platform: 'MacIntel',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        },
        'unsupported',
      ],
      [
        { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)' },
        'unsupported',
      ],
      [null, 'unsupported'],
    ] as const;

    for (const [navigatorLike, expected] of cases) {
      expect(detectDownloadPlatform(navigatorLike)).toBe(expected);
    }
  });

  it('links the detected platform directly to the official GitHub release asset', () => {
    const element = fixture.nativeElement as HTMLElement;
    const windowsAction = element.querySelector<HTMLAnchorElement>(
      '.auto-download-card .primary-button',
    );

    expect(windowsAction?.tagName).toBe('A');
    expect(windowsAction?.getAttribute('href')).toBe(
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-Windows-x64.zip',
    );
    expect(windowsAction?.textContent).toContain('下載適用於這台電腦的版本');
    expect(element.querySelector('.auto-download-card button')).toBeNull();
    expect(element.querySelector('progress')).toBeNull();
    expect(element.textContent).toContain('進度與安全檢查由瀏覽器顯示');

    fixture.componentInstance.detectedPlatform.set('macos');
    fixture.detectChanges();

    expect(
      element
        .querySelector<HTMLAnchorElement>('.auto-download-card .primary-button')
        ?.getAttribute('href'),
    ).toBe(
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    );
  });

  it('blocks Linux and unsupported devices without exposing a GitHub download URL', () => {
    let timeoutCallback: (() => void) | undefined;
    const browserWindow = TestBed.inject(DOCUMENT).defaultView;
    expect(browserWindow).not.toBeNull();
    vi.spyOn(browserWindow!, 'setTimeout').mockImplementation((handler) => {
      if (typeof handler === 'function') {
        timeoutCallback = () => handler();
      }
      return 1;
    });

    fixture.componentInstance.detectedPlatform.set('linux');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.auto-download-card a.primary-button')).toBeNull();
    expect(element.querySelector('.auto-download-card button.primary-button')).not.toBeNull();
    const toast = element.querySelector<HTMLOutputElement>('output.support-toast');
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    expect(toast?.textContent).toContain('目前不支援 Linux');
    expect(timeoutCallback).toBeDefined();

    timeoutCallback?.();
    fixture.detectChanges();
    expect(fixture.componentInstance.supportToast()).toBeNull();

    fixture.componentInstance.detectedPlatform.set('unsupported');
    fixture.detectChanges();
    const unsupportedButton = element.querySelector<HTMLButtonElement>(
      '.auto-download-card button.primary-button',
    );
    unsupportedButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.auto-download-card a.primary-button')).toBeNull();
    expect(element.querySelector('output.support-toast')?.textContent).toContain(
      '目前不支援這個裝置',
    );
  });
});
