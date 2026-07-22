import { DOCUMENT } from '@angular/common';
import { HttpEventType, HttpHeaders } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { onRequestGet as proxyReleaseDownload } from '../../../../functions/api/download/[platform]';
import { detectDownloadPlatform, DownloadsPage } from './downloads';

describe('DownloadsPage high-risk contracts', () => {
  let fixture: ComponentFixture<DownloadsPage>;
  let httpTesting: HttpTestingController;
  let createObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createObjectUrl = vi.fn(() => 'blob:release-download');
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [DownloadsPage],
      providers: [provideRouter([]), provideHttpClientTesting()],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DownloadsPage);
    fixture.detectChanges();
    fixture.componentInstance.detectedPlatform.set('windows');
    fixture.componentInstance.dismissSupportToast();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTesting.verify();
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

  it('offers one detected-platform action and requests only that platform', () => {
    const element = fixture.nativeElement as HTMLElement;
    const downloadButtons = element.querySelectorAll('.auto-download-card .primary-button');

    expect(downloadButtons).toHaveLength(1);
    expect(downloadButtons[0].textContent).toContain('下載適用於這台電腦的版本');
    expect(element.querySelector('.download-grid')).toBeNull();

    fixture.componentInstance.downloadForDetectedPlatform();
    const request = httpTesting.expectOne('/api/download/windows');
    expect(request.request.method).toBe('GET');
    request.flush(new Blob(['unavailable']), { status: 502, statusText: 'Bad Gateway' });
  });

  it('blocks Linux downloads with an accessible toast that expires after six seconds', () => {
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
    fixture.componentInstance.downloadForDetectedPlatform();
    fixture.detectChanges();

    httpTesting.expectNone((request) => request.url.startsWith('/api/download/'));
    const toast = (fixture.nativeElement as HTMLElement).querySelector<HTMLOutputElement>(
      'output.support-toast',
    );
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    expect(toast?.textContent).toContain('目前不支援 Linux');
    expect(timeoutCallback).toBeDefined();

    timeoutCallback?.();
    fixture.detectChanges();
    expect(fixture.componentInstance.supportToast()).toBeNull();
  });

  it('preserves cancelled progress and saves only a completed release ZIP', () => {
    fixture.componentInstance.startDownload('windows');
    const cancelled = httpTesting.expectOne('/api/download/windows');
    cancelled.event({ type: HttpEventType.DownloadProgress, loaded: 50, total: 100 });
    fixture.componentInstance.cancelDownload();
    fixture.detectChanges();

    expect(fixture.componentInstance.progressValue()).toBe(50);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('progress')?.getAttribute('value'),
    ).toBe('50');

    fixture.componentInstance.startDownload('windows');
    const completed = httpTesting.expectOne('/api/download/windows');
    expect(completed.request.reportProgress).toBe(true);
    expect(completed.request.responseType).toBe('blob');
    completed.event({ type: HttpEventType.DownloadProgress, loaded: 75, total: 100 });

    const archive = new Blob(['release'], { type: 'application/zip' });
    completed.flush(archive, {
      headers: new HttpHeaders({
        'Content-Type': 'application/zip',
        'X-GamerCatch-Download': 'release',
      }),
    });
    fixture.detectChanges();

    expect(createObjectUrl).toHaveBeenCalledWith(archive);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('下載完成');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLAnchorElement>('.progress-actions a')
        ?.getAttribute('href'),
    ).toBe('/generator');
  });

  it('uses the official fallback and never saves a successful HTML response as a ZIP', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    upstreamFetch.mockResolvedValueOnce(
      new Response('<html>not a release</html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    const rejectedProxyResponse = await proxyReleaseDownload({
      params: { platform: 'windows' },
      request: new Request('https://gamer-catch.pylot.dev/api/download/windows'),
    });
    expect(rejectedProxyResponse.status).toBe(502);
    expect(rejectedProxyResponse.headers.get('X-GamerCatch-Download')).toBeNull();

    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);
    upstreamFetch.mockResolvedValueOnce(
      new Response(zipBytes, {
        headers: {
          'Content-Length': String(zipBytes.byteLength),
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
    const acceptedProxyResponse = await proxyReleaseDownload({
      params: { platform: 'macos' },
      request: new Request('https://gamer-catch.pylot.dev/api/download/macos'),
    });
    expect(acceptedProxyResponse.status).toBe(200);
    expect(acceptedProxyResponse.headers.get('Content-Type')).toBe('application/zip');
    expect(acceptedProxyResponse.headers.get('X-GamerCatch-Download')).toBe('release');
    expect(new Uint8Array(await acceptedProxyResponse.arrayBuffer())).toEqual(zipBytes);

    fixture.componentInstance.startDownload('macos');
    const failed = httpTesting.expectOne('/api/download/macos');
    failed.flush(new Blob(['error']), { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();

    const fallback = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '.progress-actions a',
    );
    expect(fallback?.href).toBe(
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    );

    fixture.componentInstance.startDownload('windows');
    const html = httpTesting.expectOne('/api/download/windows');
    html.flush(new Blob(['<html>not a release</html>'], { type: 'text/html' }), {
      headers: new HttpHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'X-GamerCatch-Download': 'release',
      }),
    });
    fixture.detectChanges();

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(fixture.componentInstance.downloadState().status).toBe('error');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('GitHub 直接下載');
  });
});
