import { test, expect, request, APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BFF_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8090';
const AUTH_DIR = path.resolve(__dirname, '../../../playwright/.auth');

interface CsrfResponse {
  token: string;
  headerName?: string;
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

test.describe('API-01: Claimant & Admin Login + CSRF Token Handshake', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  });

  test('should authenticate Claimant with 200 OK and save storageState', async () => {
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
      expect(
        state.cookies.length > 0 || Boolean(responseBody.token || responseBody.accessToken),
        'Expected session cookies or auth token in Claimant login response'
      ).toBeTruthy();
    } finally {
      await claimantContext.dispose();
    }
  });

  test('should authenticate Admin with 200 OK and save storageState', async () => {
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
      expect(
        state.cookies.length > 0 || Boolean(responseBody.token || responseBody.accessToken),
        'Expected session cookies or auth token in Admin login response'
      ).toBeTruthy();
    } finally {
      await adminContext.dispose();
    }
  });

  test('should reject invalid password with 401 Unauthorized', async () => {
    const unauthContext = await request.newContext({ baseURL: BFF_BASE_URL });

    try {
      const { loginRes } = await authenticateUser(
        unauthContext,
        'claimant@demo.com',
        'WrongPass!'
      );

      expect(loginRes.status(), 'Invalid credentials must return 401 Unauthorized').toBe(401);
      const responseBody = await loginRes.json();
      console.log(responseBody.name);
    } finally {
      await unauthContext.dispose();
    }
  });
});