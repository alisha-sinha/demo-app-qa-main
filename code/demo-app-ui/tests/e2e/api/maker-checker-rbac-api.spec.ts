import { test, expect, request , APIRequestContext} from '@playwright/test';
import fs from 'fs';
const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';

// Set your existing Claimant claim ID here or via CLAIM_ID env var (or leave empty to match by description)
const TARGET_CLAIM_ID = process.env.CLAIM_ID || '';
const EXPECTED_CLAIM_DESCRIPTION = 'Front bumper damage';
import path from 'path';

const AUTH_DIR = path.resolve(__dirname, '../../../playwright/.auth');
const ADMIN_STORAGE_PATH = path.join(AUTH_DIR, 'admin.json');

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
  const adminContext = await request.newContext({ baseURL: BFF_BASE_URL });
  try {
        const { loginRes } = await authenticateUser(
          adminContext,
          'admin@demo.com',
          'Admin123!'
        );
  
        expect(loginRes.status(), 'Admin login must return 200 OK').toBe(200);
  
        const responseBody = await loginRes.json();
        console.log(responseBody.name);
        expect(responseBody).toBeTruthy();
  
        const storageStatePath = path.join(AUTH_DIR, 'admin.json');
        const state = await adminContext.storageState({ path: storageStatePath });
    console.log(ADMIN_STORAGE_PATH);
  } finally {
    await loginContext.dispose();
  }
}

test.beforeAll(async () => {
    await ensureClaimantStorageState();
  });

test('API-04: Admin logs in and verifies Claimant existing claim is visible in Admin queue', async () => {
  const adminApi = await request.newContext({ baseURL: BFF_BASE_URL });

  try {
    // 1. Perform CSRF handshake inside the test method
    console.log('[Step 1] Fetching CSRF token for Admin login...');
    const csrfRes = await adminApi.get('/api/auth/csrf', { timeout: 20_000 });
    expect(csrfRes.status(), 'GET /api/auth/csrf must return 200 OK').toBe(200);

    const csrfBody = (await csrfRes.json()) as CsrfResponse;
    expect(csrfBody.token, 'CSRF token must not be empty').toBeTruthy();
    const csrfHeaderName = csrfBody.headerName || 'X-XSRF-TOKEN';

    // 2. Log in with Admin credentials inside the test method
    console.log('[Step 2] Logging in with Admin credentials (admin@demo.com)...');
    const loginRes = await adminApi.post('/api/auth/login', {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        [csrfHeaderName]: csrfBody.token,
      },
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
    console.log(`[Step 2 Passed] Admin logged in successfully (user=${loginBody.name || 'Admin'}).`);

    // 3. Query GET /api/admin/claims using the authenticated Admin session
    console.log('[Step 3] Querying GET /api/admin/claims to verify Claimant claim visibility...');
    const adminClaimsRes = await adminApi.get('/api/admin/claims', {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        [csrfHeaderName]: csrfBody.token,
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    });

    if (adminClaimsRes.status() !== 200) {
      console.error(
        `[Admin Queue Failed] Status: ${adminClaimsRes.status()} | Body: ${await adminClaimsRes.text()}`
      );
    }
    expect(adminClaimsRes.status(), 'GET /api/admin/claims must return 200 OK').toBe(200);

    const rawJson = await adminClaimsRes.json();
    const adminClaims: AdminClaimResponse[] = Array.isArray(rawJson)
      ? rawJson
      : rawJson.content || rawJson.claims || [];

    console.log(`[Step 3] Retrieved ${adminClaims.length} claim(s) from Admin queue.`);

    // 4. Locate the Claimant's existing claim by CLAIM_ID (if provided) or description
    const matchedClaim = TARGET_CLAIM_ID
      ? adminClaims.find((c) => (c.claimId || c.id) === TARGET_CLAIM_ID)
      : adminClaims.find((c) => c.description === EXPECTED_CLAIM_DESCRIPTION);

    if (!matchedClaim) {
      console.error(
        '[Validation Failed] Claimant claim not found in Admin queue. Available claims:',
        adminClaims.map((c) => ({
          id: c.claimId || c.id,
          description: c.description,
          status: c.status,
        }))
      );
    }

    expect(
      matchedClaim,
      'Claimant submitted claim must be visible in the Admin claims section'
    ).toBeDefined();
    expect(matchedClaim!.status?.toUpperCase()).toBe('SUBMITTED');

    console.log(
      `[Step 4 Passed] Claim is visible to Admin | claimId=${matchedClaim!.claimId || matchedClaim!.id} | status=${matchedClaim!.status} | amount=${matchedClaim!.claimAmount}`
    );
  } finally {
    await adminApi.dispose();
  }
});