import { test, expect, Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminClaimsPage } from './pages/AdminClaimsPage';

const UI_BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

/**
 * Helper to submit a claim using the authenticated Claimant browser session
 * and return its 8-character short Claim ID shown in the UI tables.
 */
async function createClaimAsLoggedInClaimant(
  page: Page,
  description: string,
  claimAmount: number
): Promise<string> {
  const result = await page.evaluate(
    async ({ desc, amount }) => {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'include' });
      const csrfData = await csrfRes.json();
      const headerName = csrfData.headerName || 'X-XSRF-TOKEN';

      const res = await fetch('/api/claims', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          [headerName]: csrfData.token,
        },
        body: JSON.stringify({
          incidentDate: '2026-11-15',
          incidentLocation: 'Main Street',
          claimAmount: amount,
          description: desc,
        }),
      });

      return { status: res.status, body: await res.json() };
    },
    { desc: description, amount: claimAmount }
  );

  expect([200, 201], `Claim creation failed with status ${result.status}`).toContain(
    result.status
  );

  const fullId: string = result.body.claimId || result.body.id;
  expect(fullId, 'Created claim must return a valid ID').toBeTruthy();
  return fullId.slice(0, 8);
}

test.describe('PW-UI-08: Real-Time / Cross-Session Status Sync Reflected to Claimant', () => {
  test('should reflect Admin Approved (Claim A) and Rejected (Claim B) statuses in Claimant storageState context', async ({
    browser,
  }) => {
    // 1. Log in as Claimant and capture storageState
    const claimantSetupContext = await browser.newContext();
    const claimantSetupPage = await claimantSetupContext.newPage();

    const claimantLogin = new LoginPage(claimantSetupPage);
    await claimantSetupPage.goto(`${UI_BASE_URL}/login?redirect=%2Fclaims`);
    await claimantLogin.enterEmail('claimant@demo.com');
    await claimantLogin.enterPassword('Claimant123!');
    await claimantLogin.clickLogin();

    await expect(claimantSetupPage).toHaveURL(/\/claims(?:\?.*)?$/, { timeout: 20_000 });
    await expect(
      claimantSetupPage.getByRole('heading', { name: 'My Claims' })
    ).toBeVisible({ timeout: 15_000 });

    // Create Claim A (to be Approved) and Claim B (to be Rejected)
    const claimAId = await createClaimAsLoggedInClaimant(
      claimantSetupPage,
      `PW-UI-08 Claim A Approval Sync ${Date.now()}`,
      3200
    );
    const claimBId = await createClaimAsLoggedInClaimant(
      claimantSetupPage,
      `PW-UI-08 Claim B Rejection Sync ${Date.now()}`,
      1800
    );

    const claimantStorageState = await claimantSetupContext.storageState();
    await claimantSetupContext.close();

    // 2. Log in as Admin in an isolated context and update Claim A -> Approved, Claim B -> Rejected
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    try {
      const adminLogin = new LoginPage(adminPage);
      const adminClaimsPage = new AdminClaimsPage(adminPage);

      await adminPage.goto(`${UI_BASE_URL}/login?redirect=%2Fadmin%2Fclaims`);
      await adminLogin.enterEmail('admin@demo.com');
      await adminLogin.enterPassword('Admin123!');
      await adminLogin.clickLogin();

      await expect(adminPage).toHaveURL(/\/admin\/(claims|dashboard)(?:\?.*)?$/, {
        timeout: 20_000,
      });

      await adminClaimsPage.goto();

      // Claim A: Submitted -> Under Review -> Approved
      await adminClaimsPage.updateClaimStatus(claimAId, 'Under Review');
      await adminClaimsPage.updateClaimStatus(claimAId, 'Approved');

      // Claim B: Submitted -> Rejected
      await adminClaimsPage.updateClaimStatus(claimBId, 'Rejected');
    } finally {
      await adminContext.close();
    }

    // 3. Switch back to Claimant storageState context and verify both updated status badges
    const claimantVerifyContext = await browser.newContext({
      storageState: claimantStorageState,
    });
    const claimantPage = await claimantVerifyContext.newPage();

    try {
      await claimantPage.goto(`${UI_BASE_URL}/claims`);
      await expect(
        claimantPage.getByRole('heading', { name: 'My Claims' })
      ).toBeVisible({ timeout: 15_000 });

      // Inspect status badge for Claim A (Approved)
      const claimARow = claimantPage.getByRole('row').filter({ hasText: claimAId });
      await expect(claimARow).toBeVisible({ timeout: 15_000 });
      await expect(
        claimARow.getByRole('status', { name: 'Claim status: Approved' })
      ).toBeVisible({ timeout: 15_000 });

      // Inspect status badge for Claim B (Rejected)
      const claimBRow = claimantPage.getByRole('row').filter({ hasText: claimBId });
      await expect(claimBRow).toBeVisible({ timeout: 15_000 });
      await expect(
        claimBRow.getByRole('status', { name: 'Claim status: Rejected' })
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await claimantVerifyContext.close();
    }
  });
});