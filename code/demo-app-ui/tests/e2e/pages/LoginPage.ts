import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly showPasswordButton: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.showPasswordButton = page.getByRole('button', { name: 'Show password' });
    this.loginButton = page.getByRole('button', { name: 'Log In' });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async enterEmail(email: string) {
    await this.emailInput.fill(email);
  }

  async enterPassword(password: string) {
    await this.passwordInput.fill(password);
  }

  async showPassword() {
    await this.showPasswordButton.click();
    await expect(this.passwordInput).toHaveAttribute('type', 'text');
  }

  async clickLogin() {
    await this.loginButton.click();
  }

  async loginWithShowPassword(email: string, password: string) {
    await this.enterEmail(email);
    await this.enterPassword(password);
    await this.showPassword();
    await this.clickLogin();
  }
}