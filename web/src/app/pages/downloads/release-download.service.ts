import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export type DownloadPlatform = 'macos' | 'windows';

export interface ReleaseDownload {
  readonly endpoint: string;
  readonly directUrl: string;
  readonly fileName: string;
  readonly platformLabel: string;
}

export const RELEASE_DOWNLOADS: Readonly<Record<DownloadPlatform, ReleaseDownload>> = {
  macos: {
    endpoint: '/api/download/macos',
    directUrl:
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    fileName: 'GamerCatch-macOS-arm64.zip',
    platformLabel: 'macOS',
  },
  windows: {
    endpoint: '/api/download/windows',
    directUrl:
      'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-Windows-x64.zip',
    fileName: 'GamerCatch-Windows-x64.zip',
    platformLabel: 'Windows',
  },
};

@Injectable({ providedIn: 'root' })
export class ReleaseDownloadService {
  private readonly http = inject(HttpClient);

  download(platform: DownloadPlatform): Observable<HttpEvent<Blob>> {
    return this.http.get(RELEASE_DOWNLOADS[platform].endpoint, {
      observe: 'events',
      reportProgress: true,
      responseType: 'blob',
    });
  }
}
