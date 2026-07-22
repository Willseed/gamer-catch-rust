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

  it('shows setup step 2 and points the final action to the placement instructions', () => {
    const element = fixture.nativeElement as HTMLElement;
    const currentStep = element.querySelector('app-setup-progress [aria-current="step"]');
    const downloadButton = element.querySelector<HTMLButtonElement>('.download-actions button');
    const placementLink = element.querySelector<HTMLAnchorElement>(
      'a[href="/guide#config-placement"]',
    );

    expect(currentStep?.textContent).toContain('步驟 2');
    expect(currentStep?.textContent).toContain('產生設定');
    expect(downloadButton?.textContent).toContain('步驟 3：下載 config.toml');
    expect(placementLink?.textContent).toContain('下載後放在哪裡');
  });

  it('asks for only the service-account JSON filename and shows the fixed directory', () => {
    const element = fixture.nativeElement as HTMLElement;
    const fileNameInput = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="serviceAccountKeyFileName"]',
    );
    const prefix = element.querySelector('.credential-path-prefix');
    const help = element.querySelector('#service-account-file-help-0');
    const guideLink = element.querySelector<HTMLAnchorElement>('a[href="/guide#service-account"]');

    expect(fileNameInput?.value).toBe('person-1-service-account.json');
    expect(fileNameInput?.id).toBe('service-account-file-0');
    expect(prefix?.textContent?.trim()).toBe('credentials/');
    expect(help?.textContent).toContain('只需填 JSON 檔名，例如 ABC.json');
    expect(help?.textContent).toContain('產生器會自動加上 credentials/');
    expect(guideLink?.textContent).toContain('查看建立 service account JSON 教學');
  });

  it('adds credentials/ to the filename in the generated TOML', () => {
    fixture.componentInstance.games.at(0).controls.serviceAccountKeyFileName.setValue('ABC.json');

    expect(fixture.componentInstance.preview()).toContain(
      'service_account_key_path = "credentials/ABC.json"',
    );
    expect(fixture.componentInstance.preview()).not.toContain('credentials/credentials/');
  });

  it('uses the same filename-only pattern for the Gmail OAuth JSON', () => {
    const gmail = fixture.componentInstance.form.controls.gmail.controls;
    gmail.enabled.setValue(true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>(
      'input[formcontrolname="oauthClientSecretFileName"]',
    );
    const field = input?.closest('.form-field');
    const prefix = field?.querySelector('.credential-path-prefix');
    const help = field?.querySelector('#gmail-oauth-client-file-help');
    const guideLink = field?.querySelector<HTMLAnchorElement>('a[href="/guide#gmail-oauth"]');

    expect(input?.value).toBe('gmail-oauth-client.json');
    expect(prefix?.textContent?.trim()).toBe('credentials/');
    expect(help?.textContent).toContain('只需填 JSON 檔名');
    expect(help?.textContent).toContain('產生器會自動加上 credentials/');
    expect(guideLink?.textContent).toContain('查看建立 Gmail OAuth JSON 教學');

    gmail.oauthClientSecretFileName.setValue('my-gmail-oauth.json');
    expect(fixture.componentInstance.preview()).toContain(
      'oauth_client_secret_path = "credentials/my-gmail-oauth.json"',
    );

    gmail.oauthClientSecretFileName.setValue('credentials/my-gmail-oauth.json');
    expect(fixture.componentInstance.issues()).toContainEqual(
      expect.objectContaining({
        path: 'gmail.oauthClientSecretFileName',
        message: expect.stringContaining('只需填檔名'),
      }),
    );
  });

  it('rejects a full credentials path because the field accepts a filename only', () => {
    fixture.componentInstance.games
      .at(0)
      .controls.serviceAccountKeyFileName.setValue('credentials/ABC.json');

    expect(fixture.componentInstance.issues()).toContainEqual(
      expect.objectContaining({
        path: 'games.0.serviceAccountKeyFileName',
        message: expect.stringContaining('只需填檔名'),
      }),
    );
  });
});
