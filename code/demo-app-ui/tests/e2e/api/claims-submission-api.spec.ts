import { test, expect, request, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const AUTH_DIR = path.resolve(__dirname, '../../../playwright/.auth');
const CLAIMANT_STORAGE_PATH = path.join(AUTH_DIR, 'claimant.json');

interface CsrfResponse {
  token: string;
  headerName?: string;
}

interface SubmitClaimRequest {
  incidentDate: string;
  incidentLocation: string;
  claimAmount: number;
  description: string;
}

interface ClaimResponse {
  id?: string;
  claimId?: string;
  incidentDate: string;
  incidentLocation: string;
  claimAmount: number;
  description: string;
  status: string;
  submittedDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Helper to fetch a fresh CSRF token and header name from GET /api/auth/csrf
 */
async function getCsrfHeaders(apiContext: APIRequestContext) {
  const csrfRes = await apiContext.get('/api/auth/csrf');
  expect(csrfRes.status(), 'GET /api/auth/csrf should return 200 OK').toBe(200);

  const csrfBody = (await csrfRes.json()) as CsrfResponse;
  expect(csrfBody.token, 'CSRF token should not be empty').toBeTruthy();

  const csrfHeaderName = csrfBody.headerName || 'X-XSRF-TOKEN';
  return {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3001',
    [csrfHeaderName]: csrfBody.token,
  };
}

/**
 * Ensures playwright/.auth/claimant.json exists before running API-02 tests.
 * Reuses the saved session from API-01 if present, or logs in to generate it.
 */
async function ensureClaimantStorageState() {
/*  if (fs.existsSync(CLAIMANT_STORAGE_PATH)) {
    return;
  } */

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  async function authenticateUser(
    apiContext: APIRequestContext,
    email: string,
    password: string
  ) {
    const csrfRes = await apiContext.get('/api/auth/csrf');
    console.log('CSRF status:', csrfRes.status());
    console.log('CSRF body:', await csrfRes.text());
    expect(csrfRes.status(), 'GET /api/auth/csrf should return 200 OK').toBe(200);
  
    const csrfBody: CsrfResponse = await csrfRes.json();
    expect(csrfBody.token, 'CSRF token should not be empty').toBeTruthy();
  
    const csrfHeaderName = csrfBody.headerName || 'X-XSRF-TOKEN';
  
    const loginRes = await apiContext.post('/api/auth/login', {
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        [csrfHeaderName]: csrfBody.token,
      },
      data: { email, password },
    });
  
    if (loginRes.status() !== 200) {
      console.error(
        `[LOGIN FAILED] Email: ${email} | Status: ${loginRes.status()} | Body: ${await loginRes.text()}`
      );
    }
  
    return { loginRes, csrfToken: csrfBody.token, csrfHeaderName };
  }

  const loginContext = await request.newContext({ baseURL: BFF_BASE_URL });
  const claimantContext = await request.newContext({ baseURL: BFF_BASE_URL });
  try {
        const { loginRes } = await authenticateUser(
          claimantContext,
          'claimant@demo.com',
          'Claimant123!'
        );
  
        expect(loginRes.status(), 'Claimant login must return 200 OK').toBe(200);
  
        const responseBody = await loginRes.json();
        console.log(responseBody.name);
        expect(responseBody).toBeTruthy();
  
        const storageStatePath = path.join(AUTH_DIR, 'claimant.json');
        const state = await claimantContext.storageState({ path: storageStatePath });
    console.log(CLAIMANT_STORAGE_PATH);
  } finally {
    await loginContext.dispose();
  }
}

test.describe('API-02: Submit New Insurance Claim & Payload-to-Response Parity', () => {
  const validClaimPayload: SubmitClaimRequest = {
    incidentDate: '2026-11-15',
    incidentLocation: 'Main Street',
    claimAmount: 4000,
    description: 'Front bumper damage',
  };

  test.beforeAll(async () => {
    await ensureClaimantStorageState();
  });

  test('should submit valid claim with HTTP 200/201, status SUBMITTED, and 100% payload parity', async () => {
    const claimantApi = await request.newContext({
      baseURL: BFF_BASE_URL,
      storageState: CLAIMANT_STORAGE_PATH,
    });

    try {
      // 1. Fetch fresh CSRF token for POST /api/claims
      const headers = await getCsrfHeaders(claimantApi);
      console.log(headers);

      // 2. Send POST /api/claims with valid SubmitClaimRequestDTO payload
      const createRes = await claimantApi.post('/api/claims', {
        headers,
        data: validClaimPayload,
      });

      if (![200, 201].includes(createRes.status())) {
        console.error(
          `[CREATE CLAIM FAILED] Status: ${createRes.status()} | Body: ${await createRes.text()}`
        );
      }

      expect([200, 201], 'Valid claim submission must return HTTP 200 or 201').toContain(
        createRes.status()
      );

      // 3. Capture generated claimId & validate ClaimResponseDTO schema + deep field parity
      const createdClaim = (await createRes.json()) as ClaimResponse;
      const generatedClaimId = createdClaim.claimId || createdClaim.id;

      expect(generatedClaimId, 'Response must include generated claimId/id').toBeTruthy();
      expect(createdClaim.status?.toUpperCase()).toBe('SUBMITTED');
      expect(createdClaim.incidentDate).toBe(validClaimPayload.incidentDate);
      expect(createdClaim.incidentLocation).toBe(validClaimPayload.incidentLocation);
      expect(Number(createdClaim.claimAmount)).toBe(validClaimPayload.claimAmount);
      expect(createdClaim.description).toBe(validClaimPayload.description);
    } finally {
      await claimantApi.dispose();
    }
  });

  
});