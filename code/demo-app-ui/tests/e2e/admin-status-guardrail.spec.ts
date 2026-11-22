import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminClaimsPage } from './pages/AdminClaimsPage';

const UI_BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

test.describe('PW-UI-06: Business Rule Guardrail - CLOSED Option Hidden', () => {
  test('should hide CLOSED option when claim status is Submitted or Under Review', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const adminClaimsPage = new AdminClaimsPage(page);

    // Log in as Admin (Checker)
    await page.goto(`${UI_BASE_URL}/login?redirect=%2Fadmin%2Fclaims`);
    await loginPage.enterEmail('admin@demo.com');
    await loginPage.enterPassword('Admin123!');
    await loginPage.clickLogin();

    await expect(page).toHaveURL(/\/admin\/(claims|dashboard)(?:\?.*)?$/, {
      timeout: 20_000,
    });

    // Navigate to Claims Management (/admin/claims)
    await adminClaimsPage.goto();

    // 1. Locate a claim in 'Submitted' state and capture its short Claim ID
    const claimId = await adminClaimsPage.getFirstClaimIdByStatus('Submitted');

    // 2. Inspect its 'Update Status' dropdown and verify 'CLOSED' is strictly absent
    await adminClaimsPage.expectClosedOptionHidden(claimId);

    // 3. Update status to 'Under Review' (and confirm in the dialog)
    await adminClaimsPage.updateStatusToUnderReview(claimId);
    const claimRow = page.getByRole('row').filter({ hasText: claimId });
    await expect(
      claimRow.getByRole('status', { name: 'Claim status: Under Review' })
    ).toBeVisible({ timeout: 15_000 });

    // 4. Re-inspect 'Update Status' dropdown for the same claim and verify 'CLOSED' is still absent
    await adminClaimsPage.expectClosedOptionHidden(claimId);
  });
});