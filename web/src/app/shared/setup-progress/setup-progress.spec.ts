import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SetupProgressComponent } from './setup-progress';

describe('SetupProgressComponent', () => {
  let fixture: ComponentFixture<SetupProgressComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SetupProgressComponent] }).compileComponents();
    fixture = TestBed.createComponent(SetupProgressComponent);
  });

  it('shows the three first-run steps and marks the current one', () => {
    fixture.componentRef.setInput('currentStep', 2);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const steps = element.querySelectorAll('li');

    expect(steps).toHaveLength(3);
    expect([...steps].map((step) => step.textContent?.replace(/\s+/gu, ' ').trim())).toEqual([
      '△ 步驟 1下載程式',
      '○ 步驟 2產生設定',
      '□ 步驟 3下載並放置',
    ]);
    expect(steps[0].classList).toContain('is-complete');
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(steps[2].hasAttribute('aria-current')).toBe(false);
  });
});
