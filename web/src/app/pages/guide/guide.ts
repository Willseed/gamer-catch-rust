import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface GuideSection {
  readonly id: string;
  readonly label: string;
}

@Component({
  selector: 'app-guide',
  imports: [RouterLink],
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuidePage {
  private readonly document = inject(DOCUMENT);

  protected readonly copiedSection = signal<string | null>(null);
  protected readonly copyFailedSection = signal<string | null>(null);

  protected readonly sections: readonly GuideSection[] = [
    { id: 'download', label: '下載與完整解壓縮' },
    { id: 'system-safety', label: '系統安全提示' },
    { id: 'multiple-games-accounts', label: '多遊戲與多人帳號' },
    { id: 'prepare-sheets', label: '準備 Google 試算表' },
    { id: 'google-sheets-api', label: '啟用 Sheets API' },
    { id: 'service-account', label: '建立 service account' },
    { id: 'share-sheets', label: '分享試算表' },
    { id: 'credentials', label: '放置 JSON 憑證' },
    { id: 'gmail-oauth', label: '建立 Gmail OAuth' },
    { id: 'gmail-authorization', label: 'Gmail 首次授權' },
    { id: 'gmail-notifications', label: 'Gmail 通知規則' },
    { id: 'config-generator', label: '使用設定產生器' },
    { id: 'config-fields', label: '認識設定欄位' },
    { id: 'multiple-game-config', label: '設定多個遊戲' },
    { id: 'dry-run', label: '第一次安全測試' },
    { id: 'production-run', label: '正式寫入與平常執行' },
    { id: 'windows-scheduled-task', label: 'Windows 每日 09:00' },
    { id: 'change-game', label: '更換遊戲' },
    { id: 'troubleshooting', label: '常見錯誤' },
    { id: 'security', label: '憑證與帳號安全' },
    { id: 'update', label: '更新 GamerCatch' },
    { id: 'checksum', label: '核對 SHA-256' },
    { id: 'checklist', label: '完成檢查表' },
  ];

  protected async copySectionLink(sectionId: string): Promise<void> {
    const browserWindow = this.document.defaultView;
    const clipboard = browserWindow?.navigator.clipboard;

    if (!browserWindow || !clipboard) {
      this.copiedSection.set(null);
      this.copyFailedSection.set(sectionId);
      return;
    }

    const sectionUrl = new URL(`/guide#${sectionId}`, browserWindow.location.origin);

    try {
      await clipboard.writeText(sectionUrl.toString());
      this.copyFailedSection.set(null);
      this.copiedSection.set(sectionId);
    } catch {
      this.copiedSection.set(null);
      this.copyFailedSection.set(sectionId);
    }
  }
}
