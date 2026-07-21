import { DOCUMENT, ViewportScroller } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, Scroll } from '@angular/router';
import { filter } from 'rxjs';

const ANCHOR_GAP_PX = 16;

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);

  constructor() {
    this.viewportScroller.setOffset(() => {
      const headerHeight = this.document
        .querySelector<HTMLElement>('.site-header')
        ?.getBoundingClientRect().height;

      return [0, Math.ceil(headerHeight ?? 0) + ANCHOR_GAP_PX];
    });

    this.router.events
      .pipe(
        filter((event): event is Scroll => event instanceof Scroll),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.handleRouterScroll(event));
  }

  handleRouterScroll(event: Scroll): void {
    if (event.scrollBehavior === 'manual') {
      return;
    }

    if (event.position) {
      this.viewportScroller.scrollToPosition(event.position, { behavior: 'instant' });
      return;
    }

    if (event.anchor) {
      this.viewportScroller.scrollToAnchor(event.anchor, {
        behavior: this.prefersReducedMotion() ? 'instant' : 'smooth',
      });
      return;
    }

    this.viewportScroller.scrollToPosition([0, 0], { behavior: 'instant' });
  }

  private prefersReducedMotion(): boolean {
    return (
      this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    );
  }
}
