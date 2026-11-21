import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../e2e/pages/LoginPage';
import { ClaimsPage } from '../e2e/pages/ClaimsPage';

type AuthFixtures = {
  authenticatedPage: Page;
  claimsPage: ClaimsPage;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.enterEmail('claimant@demo.com');
    await loginPage.enterPassword('Claimant123!');
    await loginPage.clickLogin();

    // Ensure login completes before handing off to the test
    await expect(page.getByRole('heading', { name: 'My Claims' })).toBeVisible({ timeout: 45000 });
    await use(page);
  },

  claimsPage: async ({ authenticatedPage }, use) => {
    const claimsPage = new ClaimsPage(authenticatedPage);
    await use(claimsPage);
  },
});

export { expect } from '@playwright/test';