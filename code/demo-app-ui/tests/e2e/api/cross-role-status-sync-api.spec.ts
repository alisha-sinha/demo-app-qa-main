import { test, expect, APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';

/**
 * Retrieves a fresh CSRF header/token pair for the current session state,
 * falling back to the cookie jar if rotated via Set-Cookie.
 */
async function getFreshCsrfHeaders(
  context: APIRequestContext
): Promise<Record<string, string>> {
  let headerName = 'X-XSRF-TOKEN';
  let token = '';

  const csrfRes = await context.get('/api/auth/csrf');
  if (csrfRes.ok()) {
    const csrfJson = await csrfRes.json();
    headerName = csrfJson.headerName || headerName;
    token = csrfJson.token || csrfJson.csrfToken || '';
  }

  if (!token) {
    const state = await context.storageState();
    const xsrfCookie = state.cookies.find(
      (c) =>
        c.name.toUpperCase().includes('XSRF') ||
        c.name.toUpperCase().includes('CSRF')
    );
    if (xsrfCookie) {
      token = decodeURIComponent(xsrfCookie.value);
    }
  }

  return token ? { [headerName]: token } : {};
}

/**
 * Creates an isolated APIRequestContext and authenticates via POST /api/auth/login.
 */
async function createAuthenticatedApiContext(
  requestFactory: typeof import('@playwright/test').request,
  email: string,
  password: string
): Promise<APIRequestContext> {
  const context = await requestFactory.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });

  const preLoginCsrfHeaders = await getFreshCsrfHeaders(context);

  const loginRes = await context.post('/api/auth/login', {
    headers: preLoginCsrfHeaders,
    data: { email, password },
  });
  expect(
    loginRes.status(),
    `Expected login to succeed for ${email}, got ${loginRes.status()}`
  ).toBe(200);

  return context;
}

/**
 * Creates a new claim as Claimant (POST /api/claims) and returns its claimId.
 */
async function createClaimAsClaimant(
  claimantContext: APIRequestContext,
  description: string,
  claimAmount: number
): Promise<string> {
  const csrfHeaders = await getFreshCsrfHeaders(claimantContext);

  const createRes = await claimantContext.post('/api/claims', {
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders,
    },
    data: {
      incidentDate: '2026-11-14',
      incidentLocation: 'Main Street, Pune',
      claimAmount,
      description,
    },
  });

  const responseText = await createRes.text();
  expect(
    [200, 201],
    `Expected POST /api/claims to succeed, got ${createRes.status()}. Body: ${responseText}`
  ).toContain(createRes.status());

  const body = JSON.parse(responseText);
  const claimId: string = body.claimId || body.id;
  expect(claimId, 'Created claim response must return a valid claimId').toBeTruthy();
  return claimId;
}

/**
 * Transitions claim status as Admin via PATCH /api/admin/claims/{claimId}/status
 * using the required `newStatus` DTO field.
 */
async function updateClaimStatusAsAdmin(
  adminContext: APIRequestContext,
  claimId: string,
  newStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED',
  remarks = 'Status updated by Admin'
): Promise<void> {
  const csrfHeaders = await getFreshCsrfHeaders(adminContext);

  const patchRes = await adminContext.patch(
    `/api/admin/claims/${claimId}/status`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders,
      },
      data: {
        newStatus,
        remarks,
      },
    }
  );

  const responseText = await patchRes.text();
  expect(
    patchRes.status(),
    `Expected Admin PATCH /api/admin/claims/${claimId}/status -> ${newStatus} to return 200 OK, got ${patchRes.status()}. Body: ${responseText}`
  ).toBe(200);
}

test.describe('API-06: Cross-Role Status Synchronization to Claimant View', () => {
  test('should immediately reflect Admin APPROVED and REJECTED updates in Claimant GET /api/claims/{claimId} and GET /api/claims', async ({
    playwright,
  }) => {
    const claimantContext = await createAuthenticatedApiContext(
      playwright.request,
      'claimant@demo.com',
      'Claimant123!'
    );
    const adminContext = await createAuthenticatedApiContext(
      playwright.request,
      'admin@demo.com',
      'Admin123!'
    );

    try {
      // Pre-condition setup: Claimant creates two claims
      const approvedClaimId = await createClaimAsClaimant(
        claimantContext,
        `API-06 Approval Sync Check ${Date.now()}`,
        4200
      );
      const rejectedClaimId = await createClaimAsClaimant(
        claimantContext,
        `API-06 Rejection Sync Check ${Date.now()}`,
        1950
      );

      // Admin adjudicates Claim 1 -> UNDER_REVIEW -> APPROVED
      await updateClaimStatusAsAdmin(
        adminContext,
        approvedClaimId,
        'UNDER_REVIEW',
        'Reviewing submitted claim details'
      );
      await updateClaimStatusAsAdmin(
        adminContext,
        approvedClaimId,
        'APPROVED',
        'Approved after verifying repair invoice'
      );

      // Admin adjudicates Claim 2 -> REJECTED
      await updateClaimStatusAsAdmin(
        adminContext,
        rejectedClaimId,
        'REJECTED',
        'Rejected due to missing incident report'
      );

      // Step 1 & 2: Using Claimant API context, call GET /api/claims/{claimId} and inspect ClaimResponseDTO.status
      const approvedDetailRes = await claimantContext.get(
        `/api/claims/${approvedClaimId}`
      );
      expect(approvedDetailRes.status()).toBe(200);
      const approvedDetailDto = await approvedDetailRes.json();
      expect(approvedDetailDto.claimId || approvedDetailDto.id).toBe(approvedClaimId);
      expect(String(approvedDetailDto.status).toUpperCase()).toBe('APPROVED');

      const rejectedDetailRes = await claimantContext.get(
        `/api/claims/${rejectedClaimId}`
      );
      expect(rejectedDetailRes.status()).toBe(200);
      const rejectedDetailDto = await rejectedDetailRes.json();
      expect(rejectedDetailDto.claimId || rejectedDetailDto.id).toBe(rejectedClaimId);
      expect(String(rejectedDetailDto.status).toUpperCase()).toBe('REJECTED');

      // Step 3: Call GET /api/claims using Claimant session and check summary record statuses
      const listRes = await claimantContext.get('/api/claims');
      expect(listRes.status()).toBe(200);

      const listBody = await listRes.json();
      const claimsList: Array<Record<string, unknown>> = Array.isArray(listBody)
        ? listBody
        : listBody.claims || listBody.content || [];

      const approvedSummary = claimsList.find(
        (c) => (c.claimId || c.id) === approvedClaimId
      );
      expect(
        approvedSummary,
        `Claim ${approvedClaimId} must appear in Claimant GET /api/claims list`
      ).toBeDefined();
      expect(String(approvedSummary!.status).toUpperCase()).toBe('APPROVED');

      const rejectedSummary = claimsList.find(
        (c) => (c.claimId || c.id) === rejectedClaimId
      );
      expect(
        rejectedSummary,
        `Claim ${rejectedClaimId} must appear in Claimant GET /api/claims list`
      ).toBeDefined();
      expect(String(rejectedSummary!.status).toUpperCase()).toBe('REJECTED');
    } finally {
      await claimantContext.dispose();
      await adminContext.dispose();
    }
  });
});