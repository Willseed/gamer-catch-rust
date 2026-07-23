import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { SetupProgressComponent } from '../../shared/setup-progress/setup-progress';

type DownloadPlatform = 'macos' | 'windows';

interface ReleaseDownload {
  readonly directUrl: string;
  readonly fileName: string;
}

const RELEASE_DOWNLOADS: Readonly<Record<DownloadPlatform, ReleaseDownload>> = {
  macos: {
    directUrl:
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    fileName: 'GamerCatch-macOS-arm64.zip',
  },
  windows: {
    directUrl:
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-Windows-x64.zip',
    fileName: 'GamerCatch-Windows-x64.zip',
  },
};

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

  showDetectedPlatformSupport(): void {
    const platform = this.detectedPlatform();
    if (platform === 'linux') {
      this.showLinuxUnsupportedToast();
      return;
    }
    if (platform === 'unsupported') {
      this.showSupportToast(
        '目前不支援這個裝置',
        '請使用 macOS Apple Silicon 或 Windows x64 電腦開啟此頁。',
      );
    }
  }

  dismissSupportToast(): void {
    if (this.toastTimer !== null) {
      this.document.defaultView?.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.supportToast.set(null);
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
}
