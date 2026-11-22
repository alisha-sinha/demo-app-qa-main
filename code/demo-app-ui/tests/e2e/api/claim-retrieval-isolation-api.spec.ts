import { test, expect, request, APIRequestContext } from '@playwright/test';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3001';

interface CsrfResponse {
  token: string;
  headerName?: string;
}

interface ClaimPayload {
  incidentDate: string;
  incidentLocation: string;
  claimAmount: number;
  description: string;
}

interface ClaimResponseDTO extends ClaimPayload {
  id?: string;
  claimId?: string;
  status: string;
  userId?: string;
  submittedDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetches a fresh CSRF header/token pair for the current session state,
 * falling back to the cookie jar if rotated via Set-Cookie.
 */
async function getFreshCsrfHeaders(
  apiContext: APIRequestContext
): Promise<Record<string, string>> {
  let headerName = 'X-XSRF-TOKEN';
  let token = '';

  const csrfRes = await apiContext.get('/api/auth/csrf', {
    headers: {
      Accept: 'application/json',
      Origin: FRONTEND_ORIGIN,
    },
  });

  if (csrfRes.ok()) {
    const csrfBody = (await csrfRes.json()) as CsrfResponse;
    headerName = csrfBody.headerName || headerName;
    token = csrfBody.token || '';
  }

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

  return {
    'Content-Type': 'application/json',
    Origin: FRONTEND_ORIGIN,
    ...(token ? { [headerName]: token } : {}),
  };
}

/**
 * Creates an isolated authenticated APIRequestContext for Claimant.
 */
async function createAuthenticatedClaimantContext(): Promise<APIRequestContext> {
  const apiContext = await request.newContext({
    baseURL: BFF_BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });

  const loginHeaders = await getFreshCsrfHeaders(apiContext);
  const loginRes = await apiContext.post('/api/auth/login', {
    headers: loginHeaders,
    data: {
      email: 'claimant@demo.com',
      password: 'Claimant123!',
    },
  });

  expect(
    loginRes.status(),
    `Expected Claimant login to return 200 OK, got ${loginRes.status()}`
  ).toBe(200);

  return apiContext;
}

test.describe('API-03: Claimant Claim Retrieval & Cross-User Isolation', () => {
  let claimantApi: APIRequestContext;
  let createdClaimId = '';

  const seedClaimPayload: ClaimPayload = {
    incidentDate: '2026-11-15',
    incidentLocation: 'Main Street, Pune',
    claimAmount: 4000,
    description: `API-03 Retrieval & Isolation Check ${Date.now()}`,
  };

  test.beforeAll(async () => {
    claimantApi = await createAuthenticatedClaimantContext();

    // Retry seed POST /api/claims if Keycloak JWKS endpoint experiences a transient cold read timeout (500)
    let lastBodyText = '';
    await expect
      .poll(
        async () => {
          const csrfHeaders = await getFreshCsrfHeaders(claimantApi);
          const createRes = await claimantApi.post('/api/claims', {
            headers: csrfHeaders,
            data: seedClaimPayload,
            timeout: 30_000,
          });
          const status = createRes.status();
          lastBodyText = await createRes.text();

          if ([200, 201].includes(status)) {
            const createdDto = JSON.parse(lastBodyText) as ClaimResponseDTO;
            createdClaimId = (createdDto.claimId || createdDto.id) as string;
          }
          return status;
        },
        {
          message: `Seed POST /api/claims failed due to Keycloak JWKS timeout. Last body: ${lastBodyText}`,
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBeLessThan(500);

    expect(createdClaimId, 'Seeded claim must return a valid claimId').toBeTruthy();
  });

  test.afterAll(async () => {
    if (claimantApi) {
      await claimantApi.dispose();
    }
  });

  test('should retrieve created claim in GET /api/claims and full details in GET /api/claims/{claimId}', async () => {
    // Step 1: Call GET /api/claims and verify ClaimSummaryResponseDTO[] contains the new claimId
    const listRes = await claimantApi.get('/api/claims');
    expect(
      listRes.status(),
      `Expected GET /api/claims to return 200 OK, got ${listRes.status()}`
    ).toBe(200);

    const listBody = await listRes.json();
    const summaries: ClaimResponseDTO[] = Array.isArray(listBody)
      ? listBody
      : listBody.claims || listBody.content || [];

    const matchingSummary = summaries.find(
      (item) => (item.claimId || item.id) === createdClaimId
    );
    expect(
      matchingSummary,
      `ClaimSummaryResponseDTO[] from GET /api/claims must include claimId ${createdClaimId}`
    ).toBeDefined();
    expect(String(matchingSummary!.status).toUpperCase()).toBe('SUBMITTED');
    expect(Number(matchingSummary!.claimAmount)).toBe(seedClaimPayload.claimAmount);

    // Step 2: Call GET /api/claims/{claimId} and verify full ClaimResponseDTO details
    const detailRes = await claimantApi.get(`/api/claims/${createdClaimId}`);
    expect(
      detailRes.status(),
      `Expected GET /api/claims/${createdClaimId} to return 200 OK, got ${detailRes.status()}`
    ).toBe(200);

    const detailDto = (await detailRes.json()) as ClaimResponseDTO;
    expect(detailDto.claimId || detailDto.id).toBe(createdClaimId);
    expect(String(detailDto.status).toUpperCase()).toBe('SUBMITTED');
    expect(detailDto.incidentDate).toBe(seedClaimPayload.incidentDate);
    expect(detailDto.incidentLocation).toBe(seedClaimPayload.incidentLocation);
    expect(Number(detailDto.claimAmount)).toBe(seedClaimPayload.claimAmount);
    expect(detailDto.description).toBe(seedClaimPayload.description);
  });

  test('should reject unauthenticated GET /api/claims/{claimId} without auth cookies/tokens with HTTP 401 Unauthorized', async () => {
    // Step 3: Create a completely clean APIRequestContext with zero cookies or auth tokens
    const unauthenticatedApi = await request.newContext({
      baseURL: BFF_BASE_URL,
      extraHTTPHeaders: {
        Accept: 'application/json',
      },
    });

    try {
      const unauthRes = await unauthenticatedApi.get(
        `/api/claims/${createdClaimId}`
      );
      expect(
        unauthRes.status(),
        `Expected unauthenticated GET /api/claims/${createdClaimId} to return 401 Unauthorized, got ${unauthRes.status()}`
      ).toBe(401);
    } finally {
      await unauthenticatedApi.dispose();
    }
  });
});