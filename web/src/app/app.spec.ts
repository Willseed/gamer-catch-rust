import { ViewportScroller } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

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
});
