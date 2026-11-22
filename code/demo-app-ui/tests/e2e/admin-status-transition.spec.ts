import { test, expect, Page, Locator, Browser } from '@playwright/test';
import path from 'path';
import { LoginPage } from './pages/LoginPage';
import { ClaimsPage } from './pages/ClaimsPage';

const AUTH_DIR = path.resolve(__dirname, '../../playwright/.auth');
const CLAIMANT_STORAGE_PATH = path.join(AUTH_DIR, 'claimant.json');
const ADMIN_STORAGE_PATH = path.join(AUTH_DIR, 'admin.json');

interface TransitionScenario {
  label: string;
  targetStatus: 'Approved' | 'Rejected';
  claimAmount: string;
}

const scenarios: TransitionScenario[] = [
  {
    label: 'Claim A',
    targetStatus: 'Approved',
    claimAmount: '4500',
  },
  {
    label: 'Claim B',
    targetStatus: 'Rejected',
    claimAmount: '2800',
  },
];

/**
 * Ensures valid authenticated storageState files exist for Claimant and Admin.
 * Waits for client-side hydration (/api/auth/csrf) and retries login if Next.js
 * compiles the route under heavy full-suite load.
 */
async function ensureRoleStorageStates(browser: Browser) {
  const roles = [
    {
      email: 'claimant@demo.com',
      password: 'Claimant123!',
      path: CLAIMANT_STORAGE_PATH,
      expectedUrl: /\/claims/,
    },
    {
      email: 'admin@demo.com',
      password: 'Admin123!',
      path: ADMIN_STORAGE_PATH,
      expectedUrl: /\/admin/,
    },
  ];

  for (const role of roles) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await expect(async () => {
        const loginPage = new LoginPage(page);
        const csrfReady = page
          .waitForResponse((res) => res.url().includes('/api/auth/csrf'), {
            timeout: 10_000,
          })
          .catch(() => null);

        await loginPage.goto();
        await csrfReady;

        await loginPage.enterEmail(role.email);
        await loginPage.enterPassword(role.password);
        await loginPage.clickLogin();

        await expect(page).toHaveURL(role.expectedUrl, { timeout: 15_000 });
      }).toPass({ timeout: 45_000, intervals: [2_000, 3_000] });

      await context.storageState({ path: role.path });
    } finally {
      await context.close();
    }
  }
}

/**
 * Transitions a claim row on /admin/claims ("Claims Management") using its
 * "Update Status" dropdown, confirms the dialog if shown, and asserts the
 * updated Status badge text.
 */
async function transitionClaimInAdminUI(
  page: Page,
  claimId: string,
  nextStatus: 'Under Review' | 'Approved' | 'Rejected'
) {
  const shortId = claimId.slice(0, 8);
  const claimRow: Locator = page.getByRole('row').filter({ hasText: shortId }).first();
  await expect(claimRow, `Claim row for ${shortId} should be visible`).toBeVisible({
    timeout: 15_000,
  });

  // Locate the row's "Update Status" dropdown in the Actions column
  const statusSelect = claimRow.getByRole('combobox').first();
  await expect(statusSelect).toBeVisible();

  const patchPromise = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/admin/claims/${claimId}/status`) &&
      res.request().method() === 'PATCH',
    { timeout: 20_000 }
  );

  await statusSelect.selectOption({ label: nextStatus });

  // Confirm status change if a confirmation modal appears
  const confirmBtn = page.getByRole('button', { name: /^Confirm$/i });
  if (await confirmBtn.isVisible({ timeout: 2_500 }).catch(() => false)) {
    await confirmBtn.click();
  }

  const patchRes = await patchPromise;
  expect(
    [200, 204],
    `PATCH status to ${nextStatus} must succeed for ${shortId}`
  ).toContain(patchRes.status());

  // Assert the Status column badge updates immediately to the requested status
  await expect(claimRow).toContainText(new RegExp(nextStatus, 'i'), {
    timeout: 10_000,
  });
}

test.describe('PW-UI-07: Admin Status Transition Workflow (Submitted -> Under Review -> Approved / Rejected)', () => {
  test.beforeAll(async ({ browser }) => {
    await ensureRoleStorageStates(browser);
  });

  for (const scenario of scenarios) {
    test(`should transition ${scenario.label} from Submitted -> Under Review -> ${scenario.targetStatus} and persist badge after reload`, async ({
      browser,
    }) => {
      // 1. Pre-condition: Create a fresh claim as Claimant (starts in 'Submitted')
      const claimantContext = await browser.newContext({
        storageState: CLAIMANT_STORAGE_PATH,
      });
      const claimantPage = await claimantContext.newPage();
      let createdClaimId = '';

      try {
        const claimsPage = new ClaimsPage(claimantPage);
        await claimantPage.goto('/claims');
        await claimsPage.openNewClaimForm();

        const createResponsePromise = claimantPage.waitForResponse(
          (res) =>
            res.url().includes('/api/claims') &&
            res.request().method() === 'POST' &&
            [200, 201].includes(res.status())
        );

        await claimsPage.fillAndSubmitClaim({
          incidentDate: '2026-11-15',
          incidentLocation: 'Balewadi High Street, Pune',
          claimAmount: scenario.claimAmount,
          description: `${scenario.label} UI Transition Test ${Date.now()}`,
        });

        const createRes = await createResponsePromise;
        const createdDto = await createRes.json();
        createdClaimId = createdDto.claimId || createdDto.id;
        expect(createdClaimId, 'Generated claimId must not be empty').toBeTruthy();
      } finally {
        await claimantContext.close();
      }

      // 2. Admin transitions claim on /admin/claims ("Claims Management")
      const adminContext = await browser.newContext({
        storageState: ADMIN_STORAGE_PATH,
      });
      const adminPage = await adminContext.newPage();

      try {
        await adminPage.goto('/admin/claims');
        await expect(
          adminPage.getByRole('heading', { name: /Claims Management/i })
        ).toBeVisible({ timeout: 15_000 });

        // Ensure status filter dropdown is set to "All Statuses"
        const statusFilter = adminPage
          .getByRole('combobox')
          .filter({ hasText: /All Statuses/i })
          .first();
        if (await statusFilter.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await statusFilter.selectOption({ label: 'All Statuses' });
        }

        const shortId = createdClaimId.slice(0, 8);
        const claimRow = adminPage
          .getByRole('row')
          .filter({ hasText: shortId })
          .first();

        // Verify initial Status pill badge is 'Submitted'
        await expect(claimRow).toBeVisible({ timeout: 15_000 });
        await expect(claimRow).toContainText(/Submitted/i);

        // Step 1: Submitted -> Under Review
        await transitionClaimInAdminUI(adminPage, createdClaimId, 'Under Review');

        // Step 2: Under Review -> Approved / Rejected
        await transitionClaimInAdminUI(
          adminPage,
          createdClaimId,
          scenario.targetStatus
        );

        // Step 3: Reload /admin/claims and verify the final Status badge persists
        await adminPage.reload({ waitUntil: 'networkidle' });

        const reloadedRow = adminPage
          .getByRole('row')
          .filter({ hasText: shortId })
          .first();
        await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
        await expect(reloadedRow).toContainText(
          new RegExp(scenario.targetStatus, 'i')
        );
      } finally {
        await adminContext.close();
      }
    });
  }
});