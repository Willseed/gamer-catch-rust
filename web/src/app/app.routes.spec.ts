import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withInMemoryScrolling } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routerScrollingOptions } from './app.config';
import { routes } from './app.routes';

describe('guide route contract', () => {
  it('preserves direct, table-of-contents, and cross-page fragments', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withInMemoryScrolling(routerScrollingOptions))],
    });
    const harness = await RouterTestingHarness.create('/guide#quick-start');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/guide#quick-start');
    expect(harness.routeNativeElement?.querySelector('#quick-start')).not.toBeNull();

    await harness.navigateByUrl('/guide');
    const tableOfContentsLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/guide#change-game"]',
    );
    tableOfContentsLink?.click();
    await vi.waitFor(() => expect(router.url).toBe('/guide#change-game'));
    expect(harness.routeNativeElement?.querySelector('#change-game')).not.toBeNull();

    await harness.navigateByUrl('/downloads');
    const crossPageLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'a[href="/guide#checksums"]',
    );
    crossPageLink?.click();
    await vi.waitFor(() => expect(router.url).toBe('/guide#checksums'));
    expect(harness.routeNativeElement?.querySelector('#checksums')).not.toBeNull();
  });
});
