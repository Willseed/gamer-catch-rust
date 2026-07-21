import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GeneratorPage } from './generator';

describe('GeneratorPage', () => {
  let fixture: ComponentFixture<GeneratorPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GeneratorPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GeneratorPage);
    fixture.detectChanges();
  });

  it('explains the mobile and PC ranking category values next to the input', () => {
    const element = fixture.nativeElement as HTMLElement;
    const categoryInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="category"]',
    );
    const categoryHelp = element.querySelector('#category-help');

    expect(categoryInput?.value).toBe('30');
    expect(categoryInput?.getAttribute('aria-describedby')).toBe('category-help');
    expect(categoryHelp?.textContent).toContain('30 = 手機排行榜');
    expect(categoryHelp?.textContent).toContain('500 = PC 排行榜');
    expect(categoryHelp?.textContent).toContain('所有啟用遊戲都必須出現在同一個排行榜');
  });

  it('uses category 500 in the generated config when PC ranking is selected', () => {
    fixture.componentInstance.form.controls.bahamut.controls.category.setValue(500);

    expect(fixture.componentInstance.preview()).toContain('category = 500');
  });
});
