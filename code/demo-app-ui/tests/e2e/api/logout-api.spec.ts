import { test, expect, request, APIRequestContext } from '@playwright/test';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3001';

interface CsrfResponse {
  token: string;
  headerName?: string;
}

/**
 * Fetches a fresh CSRF header/token pair from GET /api/auth/csrf,
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
 * Logs in a user, verifies protected endpoint access, executes POST /api/auth/logout,
 * and asserts that subsequent protected calls fail with 401 Unauthorized.
 */
async function verifyLogoutLifecycleForRole(
  roleName: string,
  email: string,
  password: string,
  protectedEndpoint: string
) {
  const apiContext = await request.newContext({
    baseURL: BFF_BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });

  try {
    // 1. Authenticate user via POST /api/auth/login
    const loginHeaders = await getFreshCsrfHeaders(apiContext);
    const loginRes = await apiContext.post('/api/auth/login', {
      headers: loginHeaders,
      data: { email, password },
    });
    expect(
      loginRes.status(),
      `[${roleName}] Expected login to return 200 OK, got ${loginRes.status()}`
    ).toBe(200);

    // 2. Confirm active session can access protected GET endpoint (with retry for cold JWKS fetch)
    await expect
      .poll(
        async () => {
          const res = await apiContext.get(protectedEndpoint, {
            timeout: 30_000,
          });
          return res.status();
        },
        {
          message: `[${roleName}] Protected GET ${protectedEndpoint} should succeed before logout`,
          intervals: [1_500, 3_000, 5_000],
          timeout: 30_000,
        }
      )
      .toBe(200);

    // 3. Execute POST /api/auth/logout with fresh CSRF header
    const logoutHeaders = await getFreshCsrfHeaders(apiContext);
    const logoutRes = await apiContext.post('/api/auth/logout', {
      headers: logoutHeaders,
    });

    const logoutBody = await logoutRes.text();
    expect(
      [200, 204],
      `[${roleName}] Expected POST /api/auth/logout to return 200 or 204, got ${logoutRes.status()}. Body: ${logoutBody}`
    ).toContain(logoutRes.status());

    // 4. Verify session revocation: re-calling protected endpoint must return 401 Unauthorized
    const postLogoutRes = await apiContext.get(protectedEndpoint);
    expect(
      postLogoutRes.status(),
      `[${roleName}] Expected GET ${protectedEndpoint} after logout to return 401 Unauthorized, got ${postLogoutRes.status()}`
    ).toBe(401);
  } finally {
    await apiContext.dispose();
  }
}

test.describe('API-08: User Logout & Session Invalidation (Claimant & Admin)', () => {
  test('should log out both Claimant and Admin and revoke their active sessions', async () => {
    // Validate Claimant (Maker) logout lifecycle
    await verifyLogoutLifecycleForRole(
      'Claimant',
      'claimant@demo.com',
      'Claimant123!',
      '/api/claims'
    );

    // Validate Admin (Checker) logout lifecycle
    await verifyLogoutLifecycleForRole(
      'Admin',
      'admin@demo.com',
      'Admin123!',
      '/api/admin/claims'
    );
  });
});