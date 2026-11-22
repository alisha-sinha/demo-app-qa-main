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
 * Extracts records and total count from either a flat JSON array or a paginated wrapper.
 */
function extractCollectionAndTotal(payload: unknown): {
  items: Array<Record<string, unknown>>;
  totalCount: number;
} {
  if (Array.isArray(payload)) {
    return {
      items: payload as Array<Record<string, unknown>>,
      totalCount: payload.length,
    };
  }

  const obj = payload as Record<string, unknown>;
  const items = (obj.claims ||
    obj.users ||
    obj.content ||
    obj.data ||
    []) as Array<Record<string, unknown>>;

  const totalCount =
    typeof obj.totalElements === 'number'
      ? obj.totalElements
      : typeof obj.total === 'number'
        ? obj.total
        : items.length;

  return { items, totalCount };
}

test.describe('API-07: Admin Dashboard Statistics & Cache Flush Reconciliation', () => {
  test('should flush dashboard cache and reconcile DashboardStatsResponseDTO totals against /api/admin/claims and /api/admin/users', async ({
    playwright,
  }) => {
    const adminContext = await createAuthenticatedApiContext(
      playwright.request,
      'admin@demo.com',
      'Admin123!'
    );

    try {
      // Step 1: Call POST /api/admin/dashboard/flush-cache with fresh CSRF header
      const csrfHeaders = await getFreshCsrfHeaders(adminContext);
      const flushRes = await adminContext.post('/api/admin/dashboard/flush-cache', {
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders,
        },
      });
      const flushBodyText = await flushRes.text();
      expect(
        [200, 204],
        `Expected POST /api/admin/dashboard/flush-cache to return 200 or 204, got ${flushRes.status()}. Body: ${flushBodyText}`
      ).toContain(flushRes.status());
      
      // Step 2: Call GET /api/admin/dashboard/stats
      const statsRes = await adminContext.get('/api/admin/dashboard/stats');
      expect(statsRes.status()).toBe(200);
      const statsDto = await statsRes.json();

      // Step 3: Call GET /api/admin/claims and GET /api/admin/users (request large page size in case endpoints paginate)
      const [claimsRes, usersRes] = await Promise.all([
        adminContext.get('/api/admin/claims', { params: { size: '1000', page: '0' } }),
        adminContext.get('/api/admin/users', { params: { size: '1000', page: '0' } }),
      ]);

      expect(claimsRes.status()).toBe(200);
      expect(usersRes.status()).toBe(200);

      const { items: claimsList, totalCount: actualTotalClaims } =
        extractCollectionAndTotal(await claimsRes.json());
      const { totalCount: actualTotalUsers } =
        extractCollectionAndTotal(await usersRes.json());

      // Step 4: Compare DashboardStatsResponseDTO counts against database list endpoints
      expect(
        statsDto.totalUsers,
        `totalUsers mismatch: stats=${statsDto.totalUsers}, /api/admin/users=${actualTotalUsers}`
      ).toBe(actualTotalUsers);

      expect(
        statsDto.totalClaims,
        `totalClaims mismatch: stats=${statsDto.totalClaims}, /api/admin/claims=${actualTotalClaims}`
      ).toBe(actualTotalClaims);

      // Tally actual per-status counts from /api/admin/claims
      const actualStatusCounts: Record<string, number> = {
        SUBMITTED: 0,
        UNDER_REVIEW: 0,
        APPROVED: 0,
        REJECTED: 0,
        CLOSED: 0,
      };

      for (const claim of claimsList) {
        const normalizedStatus = String(claim.status || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '_');
        if (normalizedStatus in actualStatusCounts) {
          actualStatusCounts[normalizedStatus] += 1;
        }
      }

      // Support either flat DTO fields (submittedClaims / submittedCount) or nested status map (claimsByStatus / byStatus)
      const statusMap = (statsDto.claimsByStatus ||
        statsDto.statusCounts ||
        statsDto.byStatus ||
        {}) as Record<string, number>;

      const getStatForStatus = (statusKey: string, camelPrefix: string): number | undefined => {
        if (typeof statusMap[statusKey] === 'number') return statusMap[statusKey];
        if (typeof statsDto[`${camelPrefix}Claims`] === 'number')
          return statsDto[`${camelPrefix}Claims`];
        if (typeof statsDto[`${camelPrefix}Count`] === 'number')
          return statsDto[`${camelPrefix}Count`];
        if (typeof statsDto[statusKey] === 'number') return statsDto[statusKey];
        return undefined;
      };

      const expectedStatusMappings: Array<{ key: string; camel: string }> = [
        { key: 'SUBMITTED', camel: 'submitted' },
        { key: 'UNDER_REVIEW', camel: 'underReview' },
        { key: 'APPROVED', camel: 'approved' },
        { key: 'REJECTED', camel: 'rejected' },
        { key: 'CLOSED', camel: 'closed' },
      ];

      for (const { key, camel } of expectedStatusMappings) {
        const reportedCount = getStatForStatus(key, camel);
        if (reportedCount !== undefined) {
          expect(
            reportedCount,
            `Status count mismatch for ${key}: stats=${reportedCount}, actual=${actualStatusCounts[key]}`
          ).toBe(actualStatusCounts[key]);
        }
      }

      // Verify sum of per-status counts equals totalClaims
      const sumOfActualStatuses = Object.values(actualStatusCounts).reduce(
        (acc, n) => acc + n,
        0
      );
      expect(sumOfActualStatuses).toBe(statsDto.totalClaims);
    } finally {
      await adminContext.dispose();
    }
  });
});