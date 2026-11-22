import { test, expect, request, APIRequestContext } from '@playwright/test';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3001';

interface CsrfResponse {
  token: string;
  headerName?: string;
}

interface NegativeAuthScenario {
  label: string;
  email: string;
  password: string;
}

const negativeAuthScenarios: NegativeAuthScenario[] = [
  {
    label: 'Unknown User with Invalid Password (wrong@demo.com / BadPass!)',
    email: 'wrong@demo.com',
    password: 'BadPass!',
  },
  {
    label: 'Claimant User with Wrong Password (claimant@demo.com / BadPass!)',
    email: 'claimant@demo.com',
    password: 'BadPass!',
  },
  {
    label: 'Admin User with Wrong Password (admin@demo.com / BadPass!)',
    email: 'admin@demo.com',
    password: 'BadPass!',
  },
];

/**
 * Fetches a fresh CSRF header/token pair from GET /api/auth/csrf.
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

test.describe('API-09: Negative Auth Security - Incorrect Username/Password Rejected via API', () => {
  for (const scenario of negativeAuthScenarios) {
    test(`should reject ${scenario.label} and prevent session creation`, async () => {
      const apiContext = await request.newContext({
        baseURL: BFF_BASE_URL,
        extraHTTPHeaders: {
          Accept: 'application/json',
        },
      });

      try {
        // 1. Fetch fresh CSRF token prior to POST /api/auth/login
        const headers = await getFreshCsrfHeaders(apiContext);

        // 2. Submit invalid credentials to POST /api/auth/login
        const loginRes = await apiContext.post('/api/auth/login', {
          headers,
          data: {
            email: scenario.email,
            password: scenario.password,
          },
        });

        const status = loginRes.status();
        const bodyText = await loginRes.text();

        // 3. Verify login is denied with 401 Unauthorized (or 400 Bad Request)
        expect(
          [400, 401],
          `Expected POST /api/auth/login to reject ${scenario.email} with 400 or 401, got ${status}. Body: ${bodyText}`
        ).toContain(status);

        // 4. Verify structured error response body (ProblemDetailDTO / message)
        if (bodyText) {
          const errorBody = JSON.parse(bodyText);
          expect(
            errorBody.detail ||
              errorBody.title ||
              errorBody.message ||
              errorBody.error,
            `Expected error payload to include a validation/auth message, got: ${bodyText}`
          ).toBeTruthy();
        }

        // 5. Verify no session/JWT cookies were issued on failed authentication
        const state = await apiContext.storageState();
        const authCookies = state.cookies.filter(
          (c) =>
            !c.name.toUpperCase().includes('XSRF') &&
            !c.name.toUpperCase().includes('CSRF')
        );
        expect(
          authCookies.length,
          `No session/auth cookies must be issued on failed login, found: ${JSON.stringify(authCookies)}`
        ).toBe(0);

        // 6. Verify protected Claimant & Admin endpoints still return 401 Unauthorized
        const [claimantCheckRes, adminCheckRes] = await Promise.all([
          apiContext.get('/api/claims'),
          apiContext.get('/api/admin/claims'),
        ]);

        expect(
          claimantCheckRes.status(),
          'Protected /api/claims must remain 401 after failed login'
        ).toBe(401);
        expect(
          adminCheckRes.status(),
          'Protected /api/admin/claims must remain 401 after failed login'
        ).toBe(401);
      } finally {
        await apiContext.dispose();
      }
    });
  }
});