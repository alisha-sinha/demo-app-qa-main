import { test, expect, request, APIRequestContext } from '@playwright/test';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3001';
const TARGET_CLAIM_ID = process.env.CLAIM_ID || '';
// Set FINAL_DECISION=REJECTED to test rejection instead of approval
const FINAL_DECISION = (process.env.FINAL_DECISION || 'APPROVED').toUpperCase() as
  | 'APPROVED'
  | 'REJECTED';

interface CsrfResponse {
  token: string;
  headerName?: string;
}

interface AdminClaimResponse {
  id?: string;
  claimId?: string;
  incidentDate: string;
  incidentLocation: string;
  claimAmount: number;
  description: string;
  status: string;
}

/**
 * Fetches a fresh CSRF token and returns standard BFF security headers.
 */
async function getCsrfHeaders(apiContext: APIRequestContext, bearerToken = '') {
  const csrfRes = await apiContext.get('/api/auth/csrf', {
    timeout: 20_000,
    headers: {
      Accept: 'application/json',
      Origin: FRONTEND_ORIGIN,
    },
  });
  expect(csrfRes.status(), 'GET /api/auth/csrf must return 200 OK').toBe(200);

  const csrfBody = (await csrfRes.json()) as CsrfResponse;
  let token = csrfBody.token || '';
  const csrfHeaderName = csrfBody.headerName || 'X-XSRF-TOKEN';

  if (!token) {
    const state = await apiContext.storageState();
    const xsrfCookie = state.cookies.find(
      (c) =>
        c.name.toUpperCase().includes('XSRF') ||
        c.name.toUpperCase().includes('CSRF')
    );
    if (xsrfCookie) {
      token = decodeURIComponent(xsrfCookie.value);
    }
  }

  expect(token, 'CSRF token must not be empty').toBeTruthy();

  return {
    'Content-Type': 'application/json',
    Origin: FRONTEND_ORIGIN,
    [csrfHeaderName]: token,
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
  };
}

/**
 * Seeds a dedicated SUBMITTED claim as Claimant so API-06 is self-contained
 * and isolated from other tests running in the full suite.
 */
async function seedSubmittedClaim(): Promise<string> {
  const claimantApi = await request.newContext({ baseURL: BFF_BASE_URL });
  let seededClaimId = '';
  let lastBody = '';

  try {
    const loginHeaders = await getCsrfHeaders(claimantApi);
    const loginRes = await claimantApi.post('/api/auth/login', {
      timeout: 30_000,
      headers: loginHeaders,
      data: {
        email: 'claimant@demo.com',
        password: 'Claimant123!',
      },
    });
    expect(loginRes.status(), 'Claimant seed login must return 200 OK').toBe(200);

    const loginBody = await loginRes.json();
    const bearerToken = loginBody.token || loginBody.accessToken || '';

    await expect
      .poll(
        async () => {
          const createHeaders = await getCsrfHeaders(claimantApi, bearerToken);
          const createRes = await claimantApi.post('/api/claims', {
            timeout: 30_000,
            headers: createHeaders,
            data: {
              incidentDate: '2026-11-15',
              incidentLocation: 'Balewadi High Street, Pune',
              claimAmount: 4200,
              description: `API-06 Lifecycle Seed Claim ${Date.now()}`,
            },
          });

          const status = createRes.status();
          lastBody = await createRes.text();
          if ([200, 201].includes(status)) {
            const dto = JSON.parse(lastBody) as AdminClaimResponse;
            seededClaimId = (dto.claimId || dto.id) as string;
          }
          return status;
        },
        {
          message: `Seed POST /api/claims failed. Last response: ${lastBody}`,
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBeLessThan(500);

    expect(seededClaimId, 'Seeded claimId must not be empty').toBeTruthy();
    return seededClaimId;
  } finally {
    await claimantApi.dispose();
  }
}

test(`API-06: Admin transitions SUBMITTED claim -> UNDER_REVIEW -> ${FINAL_DECISION}`, async () => {
  const claimId = TARGET_CLAIM_ID || (await seedSubmittedClaim());
  const adminApi = await request.newContext({ baseURL: BFF_BASE_URL });

  try {
    // 1. Log in as Admin
    console.log('[Step 1] Fetching CSRF token and logging in as Admin...');
    const loginHeaders = await getCsrfHeaders(adminApi);
    const loginRes = await adminApi.post('/api/auth/login', {
      timeout: 30_000,
      headers: loginHeaders,
      data: {
        email: 'admin@demo.com',
        password: 'Admin123!',
      },
    });

    if (loginRes.status() !== 200) {
      console.error(
        `[Admin Login Failed] Status: ${loginRes.status()} | Body: ${await loginRes.text()}`
      );
    }
    expect(loginRes.status(), 'Admin login must return 200 OK').toBe(200);

    const loginBody = await loginRes.json();
    const bearerToken = loginBody.token || loginBody.accessToken || '';
    console.log('[Step 1 Passed] Admin logged in successfully.');

    // 2. Confirm target claim is present in SUBMITTED status in GET /api/admin/claims
    console.log(`[Step 2] Verifying claimId=${claimId} in GET /api/admin/claims...`);
    let claimsList: AdminClaimResponse[] = [];
    await expect
      .poll(
        async () => {
          const listRes = await adminApi.get('/api/admin/claims', {
            timeout: 30_000,
            headers: {
              'Content-Type': 'application/json',
              Origin: FRONTEND_ORIGIN,
              ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
            },
          });
          if (listRes.status() === 200) {
            const rawJson = await listRes.json();
            claimsList = Array.isArray(rawJson)
              ? rawJson
              : rawJson.content || rawJson.claims || [];
          }
          return listRes.status();
        },
        {
          message: 'GET /api/admin/claims must return 200 OK',
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBe(200);

    const submittedClaim = claimsList.find((c) => (c.claimId || c.id) === claimId);
    expect(
      submittedClaim,
      `Expected claimId=${claimId} in Admin queue`
    ).toBeDefined();
    expect(submittedClaim!.status?.toUpperCase()).toBe('SUBMITTED');
    console.log(
      `[Step 2 Passed] Found claimId=${claimId} in status=${submittedClaim!.status}`
    );

    // 3. Transition SUBMITTED -> UNDER_REVIEW (using `newStatus` field)
    console.log(`[Step 3] Transitioning claimId=${claimId} to UNDER_REVIEW...`);
    let underReviewStatus = 0;
    let underReviewBody = '';
    await expect
      .poll(
        async () => {
          const reviewHeaders = await getCsrfHeaders(adminApi, bearerToken);
          const underReviewRes = await adminApi.patch(
            `/api/admin/claims/${claimId}/status`,
            {
              timeout: 30_000,
              headers: reviewHeaders,
              data: {
                newStatus: 'UNDER_REVIEW',
                remarks: 'Claim moved to Under Review by Admin via API test',
              },
            }
          );
          underReviewStatus = underReviewRes.status();
          underReviewBody = await underReviewRes.text();
          return underReviewStatus;
        },
        {
          message: `[Step 3 Failed] Status: ${underReviewStatus} | Body: ${underReviewBody}`,
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBeLessThan(500);

    expect(
      [200, 204],
      `Transition SUBMITTED -> UNDER_REVIEW must succeed with HTTP 200/204. Body: ${underReviewBody}`
    ).toContain(underReviewStatus);

    if (underReviewStatus === 200 && underReviewBody) {
      const updatedBody = JSON.parse(underReviewBody) as AdminClaimResponse;
      expect(updatedBody.status?.toUpperCase()).toBe('UNDER_REVIEW');
    }
    console.log(`[Step 3 Passed] claimId=${claimId} is now UNDER_REVIEW.`);

    // 4. Transition UNDER_REVIEW -> APPROVED (or REJECTED) (using `newStatus` field)
    console.log(`[Step 4] Transitioning claimId=${claimId} to ${FINAL_DECISION}...`);
    let decisionStatus = 0;
    let decisionBody = '';
    await expect
      .poll(
        async () => {
          const decisionHeaders = await getCsrfHeaders(adminApi, bearerToken);
          const decisionRes = await adminApi.patch(
            `/api/admin/claims/${claimId}/status`,
            {
              timeout: 30_000,
              headers: decisionHeaders,
              data: {
                newStatus: FINAL_DECISION,
                remarks:
                  FINAL_DECISION === 'APPROVED'
                    ? 'Claim verified and approved by Admin'
                    : 'Claim rejected due to insufficient supporting evidence',
              },
            }
          );
          decisionStatus = decisionRes.status();
          decisionBody = await decisionRes.text();
          return decisionStatus;
        },
        {
          message: `[Step 4 Failed] Status: ${decisionStatus} | Body: ${decisionBody}`,
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBeLessThan(500);

    expect(
      [200, 204],
      `Transition UNDER_REVIEW -> ${FINAL_DECISION} must succeed with HTTP 200/204. Body: ${decisionBody}`
    ).toContain(decisionStatus);

    // 5. Re-query GET /api/admin/claims to confirm the final status persisted
    console.log(`[Step 5] Verifying claimId=${claimId} shows ${FINAL_DECISION} in Admin queue...`);
    const verifyRes = await adminApi.get('/api/admin/claims', {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: FRONTEND_ORIGIN,
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    });
    expect(verifyRes.status()).toBe(200);

    const verifyJson = await verifyRes.json();
    const updatedList: AdminClaimResponse[] = Array.isArray(verifyJson)
      ? verifyJson
      : verifyJson.content || verifyJson.claims || [];

    const finalClaim = updatedList.find((c) => (c.claimId || c.id) === claimId);
    expect(finalClaim).toBeDefined();
    expect(finalClaim!.status?.toUpperCase()).toBe(FINAL_DECISION);

    console.log(
      `[Step 5 Passed] Lifecycle complete: claimId=${claimId} transitioned SUBMITTED -> UNDER_REVIEW -> ${finalClaim!.status}.`
    );
  } finally {
    await adminApi.dispose();
  }
});