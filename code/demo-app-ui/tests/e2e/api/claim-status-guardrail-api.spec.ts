import { test, expect, request } from '@playwright/test';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const TARGET_CLAIM_ID = process.env.CLAIM_ID || '';

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

test('API-05: Admin direct transition from SUBMITTED to CLOSED is rejected (State Machine Guardrail)', async () => {
  const adminApi = await request.newContext({ baseURL: BFF_BASE_URL });

  try {
    // 1. Perform CSRF handshake & log in with Admin credentials inside the test method
    console.log('[Step 1] Fetching CSRF token and logging in as Admin...');
    const csrfRes = await adminApi.get('/api/auth/csrf', { timeout: 20_000 });
    expect(csrfRes.status(), 'GET /api/auth/csrf must return 200 OK').toBe(200);

    const csrfBody = (await csrfRes.json()) as CsrfResponse;
    expect(csrfBody.token, 'CSRF token must not be empty').toBeTruthy();
    const csrfHeaderName = csrfBody.headerName || 'X-XSRF-TOKEN';

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

    // 2. Fetch existing claims from GET /api/admin/claims and pick a SUBMITTED claim
    console.log('[Step 2] Fetching existing SUBMITTED claim from GET /api/admin/claims...');
    const listRes = await adminApi.get('/api/admin/claims', {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    });
    expect(listRes.status(), 'GET /api/admin/claims must return 200 OK').toBe(200);

    const rawJson = await listRes.json();
    const claimsList: AdminClaimResponse[] = Array.isArray(rawJson)
      ? rawJson
      : rawJson.content || rawJson.claims || [];

    const submittedClaim = TARGET_CLAIM_ID
      ? claimsList.find((c) => (c.claimId || c.id) === TARGET_CLAIM_ID)
      : claimsList.find((c) => c.status?.toUpperCase() === 'SUBMITTED');

    expect(
      submittedClaim,
      'Expected an existing claim in SUBMITTED status to test invalid transition to CLOSED'
    ).toBeDefined();

    const targetClaimId = (submittedClaim!.claimId || submittedClaim!.id) as string;
    console.log(
      `[Step 2 Passed] Located SUBMITTED claim | claimId=${targetClaimId} | currentStatus=${submittedClaim!.status}`
    );

    // 3. Fetch a fresh CSRF token immediately before the state-changing PATCH request
    const patchCsrfRes = await adminApi.get('/api/auth/csrf', { timeout: 20_000 });
    expect(patchCsrfRes.status()).toBe(200);
    const patchCsrf = (await patchCsrfRes.json()) as CsrfResponse;
    const patchCsrfHeader = patchCsrf.headerName || 'X-XSRF-TOKEN';

    console.log(
      `[Step 3] Attempting invalid transition SUBMITTED -> CLOSED on PATCH /api/admin/claims/${targetClaimId}/status...`
    );
    const patchRes = await adminApi.patch(`/api/admin/claims/${targetClaimId}/status`, {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        [patchCsrfHeader]: patchCsrf.token,
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      data: {
        status: 'CLOSED',
      },
    });

    const patchBodyText = await patchRes.text();
    console.log(
      `[Step 3 Response] Status: ${patchRes.status()} | Body: ${patchBodyText}`
    );

    // Backend must reject direct SUBMITTED -> CLOSED transition (400, 403, 409, or 422)
    expect(
      [400, 403, 409, 422],
      `Direct transition SUBMITTED -> CLOSED must be rejected, but got HTTP ${patchRes.status()}`
    ).toContain(patchRes.status());

    if (patchBodyText) {
      const errorJson = JSON.parse(patchBodyText);
      expect(
        errorJson.detail || errorJson.title || errorJson.message || errorJson.error,
        'Error response must include descriptive error details'
      ).toBeTruthy();
    }

    // 4. Re-query GET /api/admin/claims to confirm the claim status remained SUBMITTED (unchanged)
    console.log('[Step 4] Verifying claim status remained SUBMITTED in Admin queue...');
    const verifyRes = await adminApi.get('/api/admin/claims', {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3001',
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    });
    expect(verifyRes.status()).toBe(200);

    const verifyJson = await verifyRes.json();
    const updatedList: AdminClaimResponse[] = Array.isArray(verifyJson)
      ? verifyJson
      : verifyJson.content || verifyJson.claims || [];

    const recheckedClaim = updatedList.find((c) => (c.claimId || c.id) === targetClaimId);
    expect(recheckedClaim).toBeDefined();
    expect(
      recheckedClaim!.status?.toUpperCase(),
      'Claim status must remain SUBMITTED after rejected CLOSED transition'
    ).toBe('SUBMITTED');

    console.log(
      `[Step 4 Passed] Guardrail verified: claimId=${targetClaimId} was blocked from closing directly and stayed ${recheckedClaim!.status}.`
    );
  } finally {
    await adminApi.dispose();
  }
});