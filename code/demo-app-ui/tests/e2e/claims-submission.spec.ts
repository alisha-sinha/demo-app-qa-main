import { test, expect } from '../fixtures/auth.fixture';

test.describe('PW-UI-03: Claimant 3-Step Claim Submission Flow', () => {
  test('should complete all 3 steps, submit claim, and display success toast', async ({ claimsPage, page }) => {
    await claimsPage.openNewClaimForm();

    await claimsPage.fillAndSubmitClaim({
      incidentDate: '2026-11-15', // YYYY-MM-DD format required by browser date input
      incidentLocation: 'Main Street',
      claimAmount: '4000',
      description: 'Vehicle collision at Main Street intersection; front bumper damaged.',
    });

    // Verify confirmation toast appears
    await claimsPage.expectSuccessToast(/Claim submitted successfully/i);

    // Verify redirect back to My Claims list (Screenshot 3)
    await expect(claimsPage.myClaimsHeading).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/claims$/);
  });
});