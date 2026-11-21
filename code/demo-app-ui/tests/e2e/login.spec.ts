import { test, expect } from '@playwright/test';

test.describe('Login Page Automation', () => {
  const loginUrl: string = 'http://localhost:3001';

  test.beforeEach(async ({ page }) => {
    await page.goto(loginUrl);
  });

  test('should login and redirect to /claims with valid credentials', async ({ page }) => {
    // Replace with valid test credentials from your environment
    await page.getByRole('textbox', { name: 'Email' }).fill('claimant@demo.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('Claimant123!');
  await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page).toHaveURL('http://localhost:3001/claims');
  });
});