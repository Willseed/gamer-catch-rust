import { ViewportScroller } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Scroll } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the accessible site navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('GamerCatch');
    expect(compiled.querySelector('nav[aria-label="主要導覽"]')).toBeTruthy();
    expect(compiled.textContent).toContain('gamer-catch.pylot.dev');
    expect(compiled.textContent).not.toContain(['gamer', 'catch.pylot.dev'].join('.'));
  });

  it('keeps anchor targets below the current sticky header height', () => {
    const viewportScroller = TestBed.inject(ViewportScroller);
    const setOffset = vi.spyOn(viewportScroller, 'setOffset');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.site-header') as HTMLElement;
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ height: 72 } as DOMRect);

    const offset = setOffset.mock.calls.at(-1)?.[0];
    expect(offset).toBeTypeOf('function');
    expect((offset as () => [number, number])()).toEqual([0, 88]);
  });

  it('smoothly scrolls to a fragment after router navigation', () => {
    const viewportScroller = TestBed.inject(ViewportScroller);
    const scrollToAnchor = vi.spyOn(viewportScroller, 'scrollToAnchor');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    fixture.componentInstance.handleRouterScroll(
      new Scroll(new NavigationEnd(1, '/guide', '/guide#test-anchor'), null, 'test-anchor'),
    );

    expect(scrollToAnchor).toHaveBeenCalledWith('test-anchor', { behavior: 'smooth' });
  });

  it('restores a saved router position without animation', () => {
    const viewportScroller = TestBed.inject(ViewportScroller);
    const scrollToPosition = vi.spyOn(viewportScroller, 'scrollToPosition');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    fixture.componentInstance.handleRouterScroll(
      new Scroll(new NavigationEnd(2, '/guide', '/guide'), [24, 80], null),
    );

    expect(scrollToPosition).toHaveBeenCalledWith([24, 80], { behavior: 'instant' });
  });
});
