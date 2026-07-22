import { ViewportScroller } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Scroll } from '@angular/router';

import { App } from './app';

describe('App navigation contract', () => {
  it('keeps canonical navigation and scrolls fragments without breaking saved positions', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    const viewportScroller = TestBed.inject(ViewportScroller);
    const setOffset = vi.spyOn(viewportScroller, 'setOffset');
    const scrollToAnchor = vi.spyOn(viewportScroller, 'scrollToAnchor');
    const scrollToPosition = vi.spyOn(viewportScroller, 'scrollToPosition');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const navigation = element.querySelector('nav[aria-label="主要導覽"]');
    expect([...navigation!.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(
      ['/downloads', '/generator', '/guide'],
    );
    expect(element.textContent).toContain('gamer-catch.pylot.dev');
    expect(element.textContent).not.toContain(['gamer', 'catch.pylot.dev'].join('.'));

    const header = element.querySelector('.site-header') as HTMLElement;
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ height: 72 } as DOMRect);
    const offset = setOffset.mock.calls.at(-1)?.[0];
    expect((offset as () => [number, number])()).toEqual([0, 88]);

    fixture.componentInstance.handleRouterScroll(
      new Scroll(new NavigationEnd(1, '/guide', '/guide#test-anchor'), null, 'test-anchor'),
    );
    expect(scrollToAnchor).toHaveBeenCalledWith('test-anchor', { behavior: 'smooth' });

    fixture.componentInstance.handleRouterScroll(
      new Scroll(new NavigationEnd(2, '/guide', '/guide'), [24, 80], null),
    );
    expect(scrollToPosition).toHaveBeenCalledWith([24, 80], { behavior: 'instant' });

    vi.restoreAllMocks();
  });
});
