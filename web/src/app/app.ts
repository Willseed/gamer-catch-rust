import { DOCUMENT, ViewportScroller } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

const ANCHOR_GAP_PX = 16;

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly viewportScroller = inject(ViewportScroller);

  constructor() {
    this.viewportScroller.setOffset(() => {
      const headerHeight = this.document
        .querySelector<HTMLElement>('.site-header')
        ?.getBoundingClientRect().height;

      return [0, Math.ceil(headerHeight ?? 0) + ANCHOR_GAP_PX];
    });
  }
}
