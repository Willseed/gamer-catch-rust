import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withInMemoryScrolling } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routerScrollingOptions } from './app.config';
import { routes } from './app.routes';

describe('guide fragment navigation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withInMemoryScrolling(routerScrollingOptions))],
    });
  });

  it('scrolls to an alias on a direct guide URL', async () => {
    const harness = await RouterTestingHarness.create('/guide#quick-start');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/guide#quick-start');
    expect(routerScrollingOptions.anchorScrolling).toBe('enabled');
    expect(harness.routeNativeElement?.querySelector('#quick-start')).not.toBeNull();
  });

  it('keeps a table-of-contents click on the guide route', async () => {
    const harness = await RouterTestingHarness.create('/guide');
    const router = TestBed.inject(Router);
    const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/guide#change-game"]',
    );

    expect(link).not.toBeNull();
    link?.click();

    await vi.waitFor(() => expect(router.url).toBe('/guide#change-game'));
    expect(harness.routeNativeElement?.querySelector('#change-game')).not.toBeNull();
  });

  it('scrolls to an alias when entering the guide from another route', async () => {
    const harness = await RouterTestingHarness.create('/downloads');
    const router = TestBed.inject(Router);
    const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/guide#checksums"]',
    );

    expect(link).not.toBeNull();
    link?.click();

    await vi.waitFor(() => expect(router.url).toBe('/guide#checksums'));
    expect(harness.routeNativeElement?.querySelector('#checksums')).not.toBeNull();
  });
});
