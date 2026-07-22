import { DOCUMENT } from '@angular/common';
import { HttpEventType, HttpHeaders } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { detectDownloadPlatform, DownloadsPage } from './downloads';

describe('detectDownloadPlatform', () => {
  it.each([
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
  ] as const)('detects %o as %s', (navigatorLike, expected) => {
    expect(detectDownloadPlatform(navigatorLike)).toBe(expected);
  });
});

describe('DownloadsPage', () => {
  let fixture: ComponentFixture<DownloadsPage>;
  let httpTesting: HttpTestingController;
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createObjectUrl = vi.fn(() => 'blob:release-download');
    revokeObjectUrl = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [DownloadsPage],
      providers: [provideRouter([]), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DownloadsPage);
    fixture.detectChanges();

    // Keep every test independent of the operating system used by the test runner.
    fixture.componentInstance.detectedPlatform.set('windows');
    fixture.componentInstance.dismissSupportToast();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
    vi.restoreAllMocks();
  });

  it('shows one automatically selected download action instead of platform choices', () => {
    fixture.componentInstance.detectedPlatform.set('windows');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const downloadButtons = element.querySelectorAll('.auto-download-card .primary-button');
    expect(downloadButtons).toHaveLength(1);
    expect(downloadButtons[0].textContent).toContain('下載適用於這台電腦的版本');
    expect(element.querySelector('.download-grid')).toBeNull();
  });

  it('downloads the automatically detected supported platform', () => {
    fixture.componentInstance.detectedPlatform.set('windows');
    fixture.componentInstance.downloadForDetectedPlatform();

    const request = httpTesting.expectOne('/api/download/windows');
    expect(request.request.method).toBe('GET');
    request.flush(new Blob(['unavailable']), { status: 502, statusText: 'Bad Gateway' });
  });

  it('automatically shows an accessible Linux support toast without starting a download', () => {
    fixture.componentInstance.detectedPlatform.set('linux');
    fixture.detectChanges();

    httpTesting.expectNone((request) => request.url.startsWith('/api/download/'));
    const element = fixture.nativeElement as HTMLElement;
    const toast = element.querySelector<HTMLOutputElement>('output.support-toast');
    expect(toast).not.toBeNull();
    expect(toast?.hasAttribute('role')).toBe(false);
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    expect(toast?.textContent).toContain('目前不支援 Linux');

    fixture.componentInstance.dismissSupportToast();
    fixture.detectChanges();
    expect(element.querySelector('.support-toast')).toBeNull();
  });

  it('automatically dismisses the support toast after six seconds', () => {
    let timeoutCallback: (() => void) | undefined;
    const browserWindow = TestBed.inject(DOCUMENT).defaultView;
    expect(browserWindow).not.toBeNull();
    const setTimeoutSpy = vi.spyOn(browserWindow!, 'setTimeout').mockImplementation((handler) => {
      if (typeof handler === 'function') {
        timeoutCallback = () => handler();
      }
      return 1;
    });

    fixture.componentInstance.detectedPlatform.set('linux');
    fixture.componentInstance.downloadForDetectedPlatform();

    expect(fixture.componentInstance.supportToast()).not.toBeNull();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 6_000);
    expect(timeoutCallback).toBeDefined();
    timeoutCallback?.();
    expect(fixture.componentInstance.supportToast()).toBeNull();
  });

  it('keeps the last known percentage when a download is cancelled', () => {
    fixture.componentInstance.startDownload('windows');
    const request = httpTesting.expectOne('/api/download/windows');
    request.event({ type: HttpEventType.DownloadProgress, loaded: 50, total: 100 });

    fixture.componentInstance.cancelDownload();
    fixture.detectChanges();

    expect(fixture.componentInstance.progressValue()).toBe(50);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('progress')?.getAttribute('value'),
    ).toBe('50');
  });

  it('reports real HTTP download progress and saves the completed ZIP', () => {
    fixture.componentInstance.startDownload('windows');
    const request = httpTesting.expectOne('/api/download/windows');

    expect(request.request.method).toBe('GET');
    expect(request.request.reportProgress).toBe(true);
    expect(request.request.responseType).toBe('blob');

    request.event({ type: HttpEventType.DownloadProgress, loaded: 50, total: 100 });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('progress')?.getAttribute('value')).toBe('50');
    expect(element.querySelector('.progress-heading strong')?.textContent).toContain('50%');

    const archive = new Blob(['release'], { type: 'application/zip' });
    request.flush(archive, {
      headers: new HttpHeaders({ 'X-GamerCatch-Download': 'release' }),
    });
    fixture.detectChanges();

    expect(createObjectUrl).toHaveBeenCalledWith(archive);
    expect(element.querySelector('.progress-heading strong')?.textContent).toContain('下載完成');
    expect(
      element.querySelector<HTMLAnchorElement>('.progress-actions a')?.getAttribute('href'),
    ).toBe('/generator');
  });

  it('offers the official direct download when the progress endpoint fails', () => {
    fixture.componentInstance.startDownload('macos');
    const request = httpTesting.expectOne('/api/download/macos');
    request.flush(new Blob(['error']), { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();

    const fallback = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '.progress-actions a',
    );
    expect(fallback?.textContent).toContain('GitHub 直接下載');
    expect(fallback?.href).toBe(
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    );
  });

  it('does not save a successful HTML fallback as a ZIP archive', () => {
    fixture.componentInstance.startDownload('windows');
    const request = httpTesting.expectOne('/api/download/windows');
    request.flush(new Blob(['<html>not a release</html>'], { type: 'text/html' }));
    fixture.detectChanges();

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(fixture.componentInstance.downloadState().status).toBe('error');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('GitHub 直接下載');
  });
});
