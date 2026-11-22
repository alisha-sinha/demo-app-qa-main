import { Page, Locator, expect } from '@playwright/test';

export class AdminClaimsPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Claims Management' });
  }

  async goto() {
    await this.page.goto('/admin/claims');
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async getFirstClaimIdByStatus(statusText: 'Submitted' | 'Under Review'): Promise<string> {
    const claimRow = this.page
      .getByRole('row')
      .filter({ has: this.page.getByRole('status', { name: `Claim status: ${statusText}` }) })
      .first();

    await expect(
      claimRow,
      `Expected at least one claim in '${statusText}' state`
    ).toBeVisible({ timeout: 15_000 });

    const claimId = (await claimRow.locator('code').first().textContent())?.trim();
    expect(claimId, 'Claim ID must be present in row').toBeTruthy();
    return claimId!;
  }

  getRowStatusDropdown(claimId: string): Locator {
    return this.page.getByRole('combobox', { name: `Update status for claim ${claimId}` });
  }

  async expectClosedOptionHidden(claimId: string) {
    const dropdown = this.getRowStatusDropdown(claimId);
    await expect(dropdown).toBeVisible({ timeout: 15_000 });

    const optionTexts = await dropdown.locator('option').allTextContents();
    expect(optionTexts.length).toBeGreaterThan(0);
    for (const text of optionTexts) {
      expect(text.trim().toUpperCase()).not.toContain('CLOSED');
    }
  }

    async updateClaimStatus(
    claimId: string,
    targetStatus: 'Under Review' | 'Approved' | 'Rejected'
  ) {
    const dropdown = this.getRowStatusDropdown(claimId);
    await expect(dropdown).toBeVisible({ timeout: 15_000 });

    const matchingOption = dropdown
      .locator('option')
      .filter({ hasText: new RegExp(targetStatus, 'i') })
      .first();
    const optionLabel = ((await matchingOption.textContent()) || targetStatus).trim();
    await dropdown.selectOption({ label: optionLabel });

    const confirmDialog = this.page.getByRole('dialog', { name: 'Confirm Status Change' });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });

    const statusPatchPromise = this.page.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/claims/') &&
        res.url().includes('/status') &&
        res.request().method() === 'PATCH',
      { timeout: 30_000 }
    );

    await confirmDialog.getByRole('button', { name: 'Confirm' }).click();

    const patchResponse = await statusPatchPromise;
    expect([200, 204]).toContain(patchResponse.status());

    const claimRow = this.page.getByRole('row').filter({ hasText: claimId });
    await expect(
      claimRow.getByRole('status', { name: `Claim status: ${targetStatus}` })
    ).toBeVisible({ timeout: 15_000 });
  }


  async updateStatusToUnderReview(claimId: string) {
    const dropdown = this.getRowStatusDropdown(claimId);
    await expect(dropdown).toBeVisible({ timeout: 15_000 });

    const matchingOption = dropdown
      .locator('option')
      .filter({ hasText: /under review|under_review/i })
      .first();
    const optionLabel = ((await matchingOption.textContent()) || 'Under Review').trim();
    await dropdown.selectOption({ label: optionLabel });

    // Confirm Status Change dialog appears after selecting the option
    const confirmDialog = this.page.getByRole('dialog', { name: 'Confirm Status Change' });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });

    const statusPatchPromise = this.page.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/claims/') &&
        res.url().includes('/status') &&
        res.request().method() === 'PATCH',
      { timeout: 30_000 }
    );

    await confirmDialog.getByRole('button', { name: 'Confirm' }).click();

    const patchResponse = await statusPatchPromise;
    expect([200, 204]).toContain(patchResponse.status());
  }
}