import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomePage } from './home';

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
  });

  it('gives first-time visitors one download-first path through all three setup steps', () => {
    const element = fixture.nativeElement as HTMLElement;
    const heroActions = element.querySelectorAll<HTMLAnchorElement>('.hero .primary-button');
    const steps = element.querySelectorAll<HTMLElement>('.journey-list > li');

    expect(heroActions).toHaveLength(1);
    expect(heroActions[0].getAttribute('href')).toBe('/downloads');
    expect(heroActions[0].textContent).toContain('步驟 1：下載 GamerCatch');
    const links = [...steps].map((step) => step.querySelector('a')?.getAttribute('href'));

    expect(steps).toHaveLength(3);
    expect([...steps].map((step) => step.querySelector('h3')?.textContent?.trim())).toEqual([
      '下載並完整解壓縮',
      '使用設定檔產生器',
      '下載設定檔並放好',
    ]);
    expect(links).toEqual(['/downloads', '/generator', '/guide#config-placement']);
  });
});
