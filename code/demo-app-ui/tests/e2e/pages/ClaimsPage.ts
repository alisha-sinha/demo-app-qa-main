import { Page, Locator, expect } from '@playwright/test';

export interface NewClaimData {
  incidentDate: string; // Format: YYYY-MM-DD for <input type="date">
  incidentLocation: string;
  claimAmount: string;
  description: string;
}

export class ClaimsPage {
  readonly page: Page;

  // Navigation & Header Controls
  readonly submitNewClaimButton: Locator;
  readonly cancelLink: Locator;

  // Step 1: Incident Details
  readonly incidentDateInput: Locator;
  readonly incidentLocationInput: Locator;
  readonly claimAmountInput: Locator;
  readonly nextButton: Locator;

  // Step 2: Supporting Details
  readonly descriptionInput: Locator;
  readonly backButton: Locator;

  // Step 3: Review & Final Submit
  readonly submitClaimButton: Locator;

  // Toast & My Claims Table / Modal
  readonly toastContainer: Locator;
  readonly myClaimsHeading: Locator;
  readonly claimDetailsModal: Locator;

  constructor(page: Page) {
    this.page = page;

    // Entry button on /claims (handles both header and empty-state buttons)
    this.submitNewClaimButton = page.getByRole('button', { name: /Submit (New|Your First) Claim/i }).first();
    this.cancelLink = page.getByRole('link', { name: 'Cancel' }).or(page.getByRole('button', { name: 'Cancel' }));

    // Step 1 Locators (matched to exact labels in screenshot 1)
    this.incidentDateInput = page.getByLabel(/When did the incident occur\?/i);
    this.incidentLocationInput = page.getByLabel(/Where did the incident occur\?/i);
    this.claimAmountInput = page.getByLabel(/Claim Amount/i);
    this.nextButton = page.getByRole('main').getByRole('button', { name: 'Next', exact: true });

    // Step 2 Locators (matched to exact label in screenshot 2)
    this.descriptionInput = page.getByLabel(/Describe what happened/i);
    this.backButton = page.getByRole('button', { name: 'Back' });

    // Step 3 Submit Button
this.submitClaimButton = page.getByRole('main').getByRole('button', { name: 'Submit Claim', exact: true });
    // Notifications & Post-Submission View (screenshot 3)
    this.toastContainer = page.locator('[data-rht-toaster]');
    this.myClaimsHeading = page.getByRole('heading', { name: 'My Claims' });
    this.claimDetailsModal = page.getByRole('dialog');
  }

  async openNewClaimForm() {
  await expect(this.page.getByRole('status', { name: 'Loading claims' })).toBeHidden({ timeout: 15000 });

  // Retry click until Next.js router transitions to /claims/new (handles cold route compilation)
  await expect(async () => {
    await this.submitNewClaimButton.click();
    await expect(this.page).toHaveURL(/\/claims\/new/, { timeout: 5000 });
  }).toPass({ timeout: 30000 });

  await expect(this.page.getByRole('heading', { name: 'Incident Details' })).toBeVisible({ timeout: 30000 });
}

  async fillStep1IncidentDetails(date: string, location: string, amount: string) {
    await this.incidentDateInput.fill(date);
    await this.incidentLocationInput.fill(location);
    await this.claimAmountInput.fill(amount);
    await this.nextButton.click();
  }

  async fillStep2SupportingDetails(description: string) {
    await expect(this.page.getByRole('heading', { name: 'Supporting Details' })).toBeVisible();
    await this.descriptionInput.fill(description);
    await this.nextButton.click();
  }

  async submitStep3Review() {
    await expect(this.page.getByText(/Step 3:\s*Review/i)).toBeVisible();
    await this.submitClaimButton.click();
  }

  async fillAndSubmitClaim(data: NewClaimData) {
    await this.fillStep1IncidentDetails(data.incidentDate, data.incidentLocation, data.claimAmount);
    await this.fillStep2SupportingDetails(data.description);
    await this.submitStep3Review();
  }

  async expectSuccessToast(expectedMessage: string | RegExp = /Claim submitted successfully/i) {
    const toast = this.toastContainer.getByRole('status').filter({ hasText: expectedMessage });
    await expect(toast).toBeVisible({ timeout: 30000 });
  }
}