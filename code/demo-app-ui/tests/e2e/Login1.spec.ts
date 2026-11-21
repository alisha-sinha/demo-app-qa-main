import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test.describe('Login Page', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('should display email, password, and login button', async () => {
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('should toggle password visibility when clicking Show', async () => {
    await loginPage.enterPassword('TestPassword@123');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');

    await loginPage.showPassword();
  });

  test('should mark inputs as invalid on empty submission', async () => {
    await loginPage.loginButton.click();

    await expect(loginPage.emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(loginPage.passwordInput).toHaveAttribute('aria-invalid', 'true');
  });

  test.only('should log in and redirect to /claims with valid credentials', async ({ page }) => {
    // Replace with valid test user credentials
    await loginPage.enterEmail('claimant@demo.com');
    await loginPage.enterPassword('Claimant123!');
    await loginPage.loginButton.click();

    await expect(page).toHaveURL(/\/claims$/, { timeout: 15000 });
  });
});