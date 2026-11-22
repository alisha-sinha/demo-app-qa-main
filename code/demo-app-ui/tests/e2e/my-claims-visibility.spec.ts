import { test, expect } from '../fixtures/auth.fixture';

/**
 * Formats an ISO date string ('YYYY-MM-DD') into the UI display format ('MMM D, YYYY'),
 * e.g., '2026-11-15' -> 'Nov 15, 2026'.
 */
function formatUiDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Formats a numeric amount into the UI currency string, e.g., 4500 -> '$4,500.00'.
 */
function formatUiCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

test.describe('PW-UI-04: Submitted Claim Visibility & Data Integrity in My Claims', () => {
  test('should display newly submitted claim in My Claims (/claims) with matching details and Submitted status', async ({
    claimsPage,
    page,
  }) => {
    const testClaim = {
      incidentDate: '2026-11-15',
      incidentLocation: 'Main Street',
      claimAmount: '4500',
      description: `Rear fender repair claim ${Date.now()}`,
    };

    // 1. Open the 3-step claim submission form via ClaimsPage POM
    await claimsPage.openNewClaimForm();

    // 2. Intercept POST /api/claims while filling & submitting the 3-step wizard
    const createClaimResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/claims') &&
        res.request().method() === 'POST',
      { timeout: 30_000 }
    );

    await claimsPage.fillAndSubmitClaim(testClaim);

    const createClaimResponse = await createClaimResponsePromise;
    expect([200, 201], 'Claim submission POST /api/claims must succeed').toContain(
      createClaimResponse.status()
    );

    const createdPayload = await createClaimResponse.json();
    const fullClaimId: string = createdPayload.claimId || createdPayload.id;
    expect(fullClaimId, 'Submission response must include generated Claim ID').toBeTruthy();

    // My Claims table renders the first 8 characters of the UUID (e.g., "dda281e4")
    const shortClaimId = fullClaimId.slice(0, 8);
    console.log(`[PW-UI-04] Captured Claim ID: full=${fullClaimId} | shortTableId=${shortClaimId}`);

    // 3. Verify confirmation toast and redirect to 'My Claims' (/claims)
    await claimsPage.expectSuccessToast(/Claim submitted successfully/i);
    await expect(claimsPage.myClaimsHeading).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/claims(?:\?.*)?$/);

    // 4. Locate the row matching the newly created Claim ID in the My Claims table
    const claimRow = page.getByRole('row').filter({ hasText: shortClaimId });
    await expect(
      claimRow,
      `Row for Claim ID ${shortClaimId} must be visible in My Claims table`
    ).toBeVisible({ timeout: 15_000 });

    // 5. Verify Date, Description, Amount, initial Status ('Submitted'), and View Details action
    const expectedDateText = formatUiDate(testClaim.incidentDate);
    const expectedAmountText = formatUiCurrency(Number(testClaim.claimAmount));

    await expect(claimRow).toContainText(shortClaimId);
    await expect(claimRow).toContainText(expectedDateText);
    await expect(claimRow).toContainText(testClaim.description);
    await expect(claimRow).toContainText(expectedAmountText);
    await expect(claimRow).toContainText('Submitted');
    await expect(claimRow.getByRole('button', { name: 'View Details' })).toBeVisible();

    console.log(
      `[PW-UI-04 PASSED] Verified row for ${shortClaimId}: Date="${expectedDateText}", Amount="${expectedAmountText}", Status="Submitted".`
    );
  });
});