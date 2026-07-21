import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-downloads',
  imports: [RouterLink],
  templateUrl: './downloads.html',
  styleUrl: './downloads.scss',
})
export class DownloadsPage {
  readonly macUrl =
    'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip';
  readonly windowsUrl =
    'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-Windows-x64.zip';
  readonly checksumsUrl =
    'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/SHA256SUMS.txt';
  readonly releaseUrl = 'https://github.com/Willseed/gamer-catch-rust/releases/latest';
}
