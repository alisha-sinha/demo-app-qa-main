import { test, expect, Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const UI_BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

/**
 * Uses LoginPage POM (role-based locators) while awaiting the auth network
 * response and tracking any HTTP 404 responses during login & redirect.
 */
async function loginAndVerifyNetwork(
  page: Page,
  email: string,
  password: string,
  loginPath = '/login?redirect=%2Fclaims'
) {
  const notFoundUrls: string[] = [];

  page.on('response', (response) => {
    if (response.status() === 404) {
      notFoundUrls.push(`${response.request().method()} ${response.url()}`);
    }
  });

  const loginPage = new LoginPage(page);
  await page.goto(`${UI_BASE_URL}${loginPath}`);

  await expect(loginPage.emailInput, 'Email textbox must be visible').toBeVisible({
    timeout: 15_000,
  });
  await expect(loginPage.passwordInput, 'Password textbox must be visible').toBeVisible();

  await loginPage.enterEmail(email);
  await loginPage.enterPassword(password);

  // Wait for the auth endpoint response triggered by clicking Log In
  const authResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes('/api/auth/login') &&
      res.request().method() === 'POST',
    { timeout: 30_000 }
  );

  await loginPage.clickLogin();

  const authResponse = await authResponsePromise;
  expect(
    authResponse.status(),
    `Expected POST /api/auth/login to return 200 OK for ${email}, got ${authResponse.status()}`
  ).toBe(200);

  return { notFoundUrls };
}

test.describe('PW-UI-02: End-to-End UI Login & Role-Based Landing Redirection', () => {
  test('Claimant logs in at /login?redirect=%2Fclaims and lands on My Claims (/claims) without 404s', async ({
    browser,
  }) => {
    const claimantContext = await browser.newContext();
    const page = await claimantContext.newPage();

    try {
      const { notFoundUrls } = await loginAndVerifyNetwork(
        page,
        'claimant@demo.com',
        'Claimant123!',
        '/login?redirect=%2Fclaims'
      );

      // Verify redirect to /claims and "My Claims" heading
      await expect(page).toHaveURL(/\/claims(?:\?.*)?$/, { timeout: 20_000 });
      await expect(
        page.getByRole('heading', { name: 'My Claims' })
      ).toBeVisible({ timeout: 15_000 });

      expect(
        notFoundUrls,
        `Unexpected 404 responses during Claimant login: ${notFoundUrls.join(', ')}`
      ).toHaveLength(0);
    } finally {
      await claimantContext.close();
    }
  });

  test('Admin logs in in a fresh context and lands on Admin Dashboard without 404s', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();

    try {
      const { notFoundUrls } = await loginAndVerifyNetwork(
        page,
        'admin@demo.com',
        'Admin123!',
        '/login?redirect=%2Fclaims'
      );

      // Verify redirect to /admin/dashboard and "Admin Dashboard" heading
      await expect(page).toHaveURL(/\/admin\/dashboard(?:\?.*)?$/, { timeout: 25_000 });
      await expect(
        page.getByRole('heading', { name: 'Admin Dashboard' })
      ).toBeVisible({ timeout: 15_000 });

      expect(
        notFoundUrls,
        `Unexpected 404 responses during Admin login: ${notFoundUrls.join(', ')}`
      ).toHaveLength(0);
    } finally {
      await adminContext.close();
    }
  });
});