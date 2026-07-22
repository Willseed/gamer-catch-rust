import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface SetupStep {
  readonly number: number;
  readonly symbol: string;
  readonly symbolClass: string;
  readonly label: string;
}

@Component({
  selector: 'app-setup-progress',
  templateUrl: './setup-progress.html',
  styleUrl: './setup-progress.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupProgressComponent {
  readonly currentStep = input(1);

  protected readonly steps: readonly SetupStep[] = [
    { number: 1, symbol: '△', symbolClass: 'triangle', label: '下載程式' },
    { number: 2, symbol: '○', symbolClass: 'circle', label: '產生設定' },
    { number: 3, symbol: '□', symbolClass: 'square', label: '下載並放置' },
  ];
}
