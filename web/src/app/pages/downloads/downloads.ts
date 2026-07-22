import { DOCUMENT } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';

import { SetupProgressComponent } from '../../shared/setup-progress/setup-progress';
import {
  RELEASE_DOWNLOADS,
  ReleaseDownloadService,
  type DownloadPlatform,
} from './release-download.service';

type DownloadStatus = 'idle' | 'starting' | 'downloading' | 'complete' | 'error' | 'cancelled';

interface DownloadState {
  readonly status: DownloadStatus;
  readonly platform: DownloadPlatform | null;
  readonly loaded: number;
  readonly total: number | null;
}

export type DetectedPlatform = DownloadPlatform | 'linux' | 'unsupported';

export interface NavigatorLike {
  readonly maxTouchPoints?: number;
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: {
    readonly mobile?: boolean;
    readonly platform?: string;
  };
}

interface PlatformView {
  readonly symbol: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly buttonLabel: string;
  readonly guideFragment: string | null;
}

interface SupportToast {
  readonly title: string;
  readonly message: string;
}

export function detectDownloadPlatform(
  navigatorLike: NavigatorLike | null | undefined,
): DetectedPlatform {
  const userAgent = navigatorLike?.userAgent?.toLowerCase() ?? '';
  const platform = (
    navigatorLike?.userAgentData?.platform ??
    navigatorLike?.platform ??
    ''
  ).toLowerCase();

  if (
    navigatorLike?.userAgentData?.mobile ||
    userAgent.includes('cros') ||
    userAgent.includes('chrome os') ||
    (platform.includes('mac') && (navigatorLike?.maxTouchPoints ?? 0) > 1) ||
    /android|iphone|ipad|ipod|mobile/.test(userAgent)
  ) {
    return 'unsupported';
  }
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (
    platform.includes('mac') ||
    userAgent.includes('macintosh') ||
    userAgent.includes('mac os x')
  ) {
    return 'macos';
  }
  if (
    platform.includes('linux') ||
    platform.includes('x11') ||
    userAgent.includes('linux') ||
    userAgent.includes('x11')
  ) {
    return 'linux';
  }
  return 'unsupported';
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function isZipContentType(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/zip';
}

@Component({
  selector: 'app-downloads',
  imports: [RouterLink, SetupProgressComponent],
  templateUrl: './downloads.html',
  styleUrl: './downloads.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadsPage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly releaseDownload = inject(ReleaseDownloadService);
  private activeDownload: Subscription | null = null;
  private toastTimer: number | null = null;

  readonly checksumsUrl =
    'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/SHA256SUMS.txt';
  readonly releaseUrl = 'https://github.com/Willseed/gamer-catch-rust/releases/latest';
  readonly detectedPlatform = signal<DetectedPlatform>(
    detectDownloadPlatform(this.document.defaultView?.navigator as NavigatorLike | undefined),
  );
  readonly supportToast = signal<SupportToast | null>(null);
  readonly detectedRelease = computed(() => {
    const platform = this.detectedPlatform();
    return platform === 'macos' || platform === 'windows' ? RELEASE_DOWNLOADS[platform] : null;
  });
  readonly platformView = computed<PlatformView>(() => {
    switch (this.detectedPlatform()) {
      case 'macos':
        return {
          symbol: '●',
          eyebrow: '已自動偵測作業系統',
          title: 'macOS Apple Silicon',
          description:
            'macOS 版本目前僅適用 M1、M2、M3、M4、M5 等 Apple 晶片 Mac；下載後解壓縮即可開始設定。',
          buttonLabel: '下載 macOS Apple Silicon 版本',
          guideFragment: 'first-setup-macos',
        };
      case 'windows':
        return {
          symbol: '▦',
          eyebrow: '已自動偵測作業系統',
          title: 'Windows x64',
          description: '適用於 Windows 10 或 11 x64，包含無需管理員權限的每日工作排程安裝腳本。',
          buttonLabel: '下載適用於這台電腦的版本',
          guideFragment: 'first-setup-windows',
        };
      case 'linux':
        return {
          symbol: '⌁',
          eyebrow: '已自動偵測作業系統',
          title: 'Linux',
          description: 'GamerCatch 目前提供 macOS Apple Silicon 與 Windows x64 正式版本。',
          buttonLabel: '查看 Linux 支援狀態',
          guideFragment: null,
        };
      default:
        return {
          symbol: '?',
          eyebrow: '目前的裝置',
          title: '無法辨識支援的平台',
          description: '請使用 macOS Apple Silicon 或 Windows x64 電腦開啟此頁下載。',
          buttonLabel: '查看裝置支援狀態',
          guideFragment: null,
        };
    }
  });

  readonly downloadState = signal<DownloadState>({
    status: 'idle',
    platform: null,
    loaded: 0,
    total: null,
  });
  readonly isDownloading = computed(() => {
    const status = this.downloadState().status;
    return status === 'starting' || status === 'downloading';
  });
  readonly selectedDownload = computed(() => {
    const platform = this.downloadState().platform;
    return platform ? RELEASE_DOWNLOADS[platform] : null;
  });
  readonly progressValue = computed(() => {
    const state = this.downloadState();
    if (state.status === 'complete') {
      return 100;
    }
    if (state.status === 'error') {
      return 0;
    }
    if (!state.total || state.total <= 0) {
      return null;
    }
    return Math.min(100, Math.round((state.loaded / state.total) * 100));
  });
  readonly progressStatus = computed(() => {
    const state = this.downloadState();
    const release = this.selectedDownload();
    switch (state.status) {
      case 'starting':
        return `正在準備 ${release?.platformLabel ?? ''} 下載…`;
      case 'downloading': {
        const percentage = this.progressValue();
        return percentage === null ? '正在下載…' : `正在下載… ${percentage}%`;
      }
      case 'complete':
        return '下載完成，請解壓縮 ZIP。';
      case 'error':
        return '無法透過網站取得下載進度，請改用 GitHub 直接下載。';
      case 'cancelled':
        return '已取消下載。';
      default:
        return '';
    }
  });
  readonly progressSize = computed(() => {
    const { status, loaded, total } = this.downloadState();
    if (status === 'error') {
      return '未下載任何檔案';
    }
    if (loaded === 0) {
      return '等待伺服器回應';
    }
    return total
      ? `${formatBytes(loaded)} / ${formatBytes(total)}`
      : `已下載 ${formatBytes(loaded)}`;
  });

  constructor() {
    effect(() => {
      if (this.detectedPlatform() === 'linux') {
        this.showLinuxUnsupportedToast();
      }
    });
    this.destroyRef.onDestroy(() => {
      if (this.toastTimer !== null) {
        this.document.defaultView?.clearTimeout(this.toastTimer);
      }
    });
  }

  downloadForDetectedPlatform(): void {
    const platform = this.detectedPlatform();
    if (platform === 'macos' || platform === 'windows') {
      this.startDownload(platform);
      return;
    }

    if (platform === 'linux') {
      this.showLinuxUnsupportedToast();
      return;
    }

    this.showSupportToast(
      '目前不支援這個裝置',
      '請使用 macOS Apple Silicon 或 Windows x64 電腦開啟此頁。',
    );
  }

  dismissSupportToast(): void {
    if (this.toastTimer !== null) {
      this.document.defaultView?.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.supportToast.set(null);
  }

  startDownload(platform: DownloadPlatform): void {
    if (this.isDownloading()) {
      return;
    }

    this.activeDownload?.unsubscribe();
    this.downloadState.set({ status: 'starting', platform, loaded: 0, total: null });
    this.activeDownload = this.releaseDownload
      .download(platform)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.downloadState.update((state) => ({
              ...state,
              status: 'downloading',
              loaded: event.loaded,
              total: event.total ?? state.total,
            }));
          } else if (event.type === HttpEventType.Response) {
            const isReleaseDownload = event.headers.get('X-GamerCatch-Download') === 'release';
            if (
              !isReleaseDownload ||
              !isZipContentType(event.headers.get('Content-Type')) ||
              !event.body ||
              event.body.size === 0 ||
              !this.saveBlob(event.body, RELEASE_DOWNLOADS[platform].fileName)
            ) {
              this.setDownloadError();
              return;
            }
            this.downloadState.update((state) => ({
              ...state,
              status: 'complete',
              loaded: event.body?.size ?? state.loaded,
              total: state.total ?? event.body?.size ?? null,
            }));
          }
        },
        error: () => this.setDownloadError(),
        complete: () => {
          this.activeDownload = null;
        },
      });
  }

  cancelDownload(): void {
    if (!this.isDownloading()) {
      return;
    }
    this.activeDownload?.unsubscribe();
    this.activeDownload = null;
    this.downloadState.update((state) => ({ ...state, status: 'cancelled' }));
  }

  retryDownload(): void {
    const platform = this.downloadState().platform;
    if (platform) {
      this.startDownload(platform);
    }
  }

  private setDownloadError(): void {
    this.activeDownload = null;
    this.downloadState.update((state) => ({
      ...state,
      status: 'error',
      loaded: 0,
      total: null,
    }));
  }

  private showSupportToast(title: string, message: string): void {
    this.dismissSupportToast();
    this.supportToast.set({ title, message });
    const browserWindow = this.document.defaultView;
    if (browserWindow) {
      this.toastTimer = browserWindow.setTimeout(() => {
        this.supportToast.set(null);
        this.toastTimer = null;
      }, 6_000);
    }
  }

  private showLinuxUnsupportedToast(): void {
    this.showSupportToast(
      '目前不支援 Linux',
      '請改用 macOS Apple Silicon 或 Windows x64 電腦下載與執行 GamerCatch。',
    );
  }

  private saveBlob(blob: Blob, fileName: string): boolean {
    const browserWindow = this.document.defaultView;
    if (!browserWindow) {
      return false;
    }

    const objectUrl = browserWindow.URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    this.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    browserWindow.setTimeout(() => browserWindow.URL.revokeObjectURL(objectUrl), 1_000);
    return true;
  }
}
