# Test Strategy & Requirement Traceability Matrix — Claim Management Application (`demo-app-qa-main`)

**Document Version:** 3.0  
**Last Updated:** November 22, 2026  
**Repository:** `demo-app-qa-main` (`code/demo-app-ui` & `code/claims-service`)  
**Automation Frameworks:** Playwright (TypeScript), Jest/Testing Library (UI Unit/Component), & JUnit 5 / Mockito (Java)  
**Suite Status:** 31 / 31 Playwright Automated Tests Passing (`playwright-report/index.html`)  

---

## 1. Objective, Risk Prioritisation & Scope

### 1.1 Objective
Establish a deterministic, risk-prioritized automated test suite across UI E2E, BFF REST API, UI Component, and Backend Domain layers for the Claim Management Application. Under a focused 2–3 hour engineering sprint target, testing effort was concentrated on business-critical financial and security boundaries: Maker-Checker Role-Based Access Control (RBAC), claim submission and adjudication state transitions, BFF security controls (CSRF double-submit handshake, CORS proxy routing, and session invalidation), and cross-role data synchronization.

### 1.2 Highest-Risk Areas Identified & Prioritisation Rationale
Based on architectural review of `demo-app-ui`, `bff-service`, and `claims-service`, the following four areas were prioritized as **Critical (P0) / High (P1)**:

1. **Maker-Checker RBAC & Privilege Escalation Boundaries (Critical — P0):**
   * *Why High Risk:* A Claimant (Maker) approving their own claim or reading another user's claims represents direct financial fraud and PII exposure. Both UI controls (`AdminClaimsPage.ts`) and BFF endpoints (`/api/admin/claims/**`) must enforce strict role separation.
2. **Claim State Machine & Premature Closure Guardrails (Critical — P0):**
   * *Why High Risk:* Claims must follow a strict lifecycle (`Submitted` $\rightarrow$ `Under Review` $\rightarrow$ `Approved` / `Rejected`). Jumping directly to `CLOSED` from `Submitted` or `Under Review` corrupts downstream financial settlement and Debezium CDC event streams.
3. **BFF Session, CSRF & Proxy Routing Security (Critical — P0):**
   * *Why High Risk:* The Next.js UI communicates with Spring Boot via `HttpOnly` session cookies and `X-XSRF-TOKEN` headers. Misconfigured proxy URLs (`bff-client.ts`) or broken logout revocation leave users unable to submit claims (`401` CORS preflight failures) or vulnerable to session replay after logout.
4. **Cross-Session State Synchronization (Critical — P0):**
   * *Why High Risk:* Adjudication decisions made by an Admin (`Approved` / `Rejected`) must immediately and accurately reflect in the Claimant's view without stale cache discrepancies.

### 1.3 In-Scope
* **UI End-to-End Workflows (`tests/e2e/*.spec.ts`):**
  * Authentication, invalid credential error feedback, idle session auto-logout (`page.clock`), and role-based post-login redirection (`/login` $\rightarrow$ `/claims` for Claimant; `/login` $\rightarrow$ `/admin` for Admin).
  * Claimant claim submission (`POST /api/claims`), toast confirmation (`[data-rht-toaster]`), and personal queue isolation ("My Claims").
  * Admin Claims Management workflow (`/admin/claims` via `AdminClaimsPage.ts`): Maker-Checker queue handover, status transitions (`Submitted` $\rightarrow$ `Under Review` $\rightarrow$ `Approved` / `Rejected`), reload persistence, and UI business-rule guardrails (`CLOSED` option hidden when status is `Submitted` or `Under Review`).
  * Real-time / cross-session status synchronization between Admin adjudication and Claimant view.
* **BFF API Contract & Security Testing (`tests/e2e/api/*.spec.ts`):**
  * CSRF double-submit cookie/header handshake (`GET /api/auth/csrf` $\rightarrow$ `X-XSRF-TOKEN`) and authentication (`POST /api/auth/login`).
  * Payload-to-response schema parity (`ClaimResponseDTO`) and cross-user claim retrieval isolation (`401`/`403` enforcement).
  * Maker-Checker RBAC API enforcement (`403 Forbidden` when Claimant invokes `/api/admin/claims` or `PATCH /api/admin/claims/{id}/status`).
  * Admin claim status state machine (`PATCH /api/admin/claims/{claimId}/status` with `newStatus` payload) and premature `CLOSED` jump rejection.
  * Admin dashboard cache flush and statistics reconciliation (`DashboardStatsResponseDTO`).
  * Session logout & token revocation lifecycle (`POST /api/auth/logout` returning `200`/`204`, followed by `401 Unauthorized` on subsequent protected `GET` requests).
* **Frontend Component & Backend Domain Unit Verification:**
  * UI component validation tests (`code/demo-app-ui/tests/unit/login-validation.test.tsx`).
  * Backend domain enforcement in `UpdateClaimStatusUseCaseTest.java` (verifying `UserRole.ADMIN` authorization, Debezium CDC vs. direct `ApplicationEventPublisher` event publishing, and Micrometer counter `claims.status.changed`).

### 1.4 Deliberately Out-of-Scope (Sprint Prioritisation Trade-Offs)
To maximize confidence within the 2–3 hour sprint window, the following items were deliberately excluded:
* **Embedded Kafka / Debezium Broker Integration Tests:** Excluded because `UpdateClaimStatusUseCaseTest.java` already verifies domain event dispatch at the unit level, while E2E API tests verify persisted state transitions end-to-end without spinning up heavy broker test containers.
* **High-Concurrency Load & Stress Benchmarking (k6 / Gatling):** Deprioritized in favor of functional correctness, RBAC guardrails, and security validation.
* **Automated Visual Regression (Storybook / Chromatic) & Cross-Browser Matrix (WebKit/Firefox Local):** Focused local execution on Chromium with semantic ARIA role assertions to keep feedback loops fast and deterministic.
* **Internal Keycloak Admin Console UI:** Treated as an external identity provider boundary; tested via BFF login, refresh, logout, and JWKS token validation contracts.

---

## 2. System Architecture & Test Environments

### 2.1 Application Topology
| Component | Technology | Local Endpoint | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | Next.js (App Router) | `http://localhost:3001` | Claimant & Admin web interface (`demo-app-ui`) + API proxy |
| **BFF / API Gateway** | Spring Boot (Web/Security) | `http://localhost:8090` | Session management, CSRF protection, Keycloak OAuth2/OIDC proxy |
| **Claims Core Service** | Spring Boot (DDD / JPA) | `http://localhost:8080` | Claim persistence, status transition use cases, Debezium CDC events |
| **Identity Provider** | Keycloak | Internal Auth Server | JWT issuance, JWKS verification, session lifecycle |

### 2.2 Test Personas & Credentials
| Persona | Role | Email | Password | Expected Landing Route |
| :--- | :--- | :--- | :--- | :--- |
| **Claimant** | Maker (`USER` / `CLAIMANT`) | `claimant@demo.com` | `Claimant123!` | `/claims` |
| **Admin** | Checker (`ADMIN`) | `admin@demo.com` | `Admin123!` | `/admin` |

---

## 3. Automation Framework Architecture & Engineering Principles

### 3.1 Complete Repository & Test Directory Structure
```text
demo-app-qa-main/
├── TEST_STRATEGY.md                                   # Test Strategy, Defect Log, RTM & Future Roadmap
├── AI_WORKING_JOURNAL.md                              # AI collaboration log (accepted, challenged, overridden)
└── code/
    ├── claims-service/
    │   └── src/
    │       ├── main/java/com/example/demo/application/usecases/
    │       │   └── UpdateClaimStatusUseCase.java       # Core domain status transition logic
    │       └── test/java/com/example/demo/application/usecases/
    │           └── UpdateClaimStatusUseCaseTest.java   # Updated unit tests aligned with domain use case
    └── demo-app-ui/
        ├── .env.local                                 # Local BFF/stub URL overrides (http://localhost:3001)
        ├── next.config.ts                             # Next.js API proxy rewrites
        ├── middleware.ts                              # Route protection & post-login redirects
        ├── playwright.config.ts                       # Consolidated testDir, timeouts, Chromium project, HTML/JUnit reporters
        ├── playwright/.auth/                          # Persisted browser storageState (claimant.json, admin.json)
        ├── src/lib/api/bff-client.ts                  # API client (defaulted to :8080 prior to .env.local fix)
        └── tests/
            ├── unit/                                  # Component unit tests (login-validation.test.tsx, theme-picker.test.tsx)
            └── e2e/
                ├── global-setup.ts                    # Pre-test environment & auth bootstrap
                ├── pages/                             # Page Object Model (POM) layer
                │   ├── AdminClaimsPage.ts             # POM for /admin/claims (Claims Management table, status dropdowns, guardrails)
                │   ├── ClaimsPage.ts                  # POM for Claimant /claims view & New Claim submission modal
                │   └── LoginPage.ts                   # POM for /login authentication & error feedback
                ├── fixtures/                          # Reusable fixtures & test data builders
                │   ├── auth.fixture.ts                # Isolated Claimant & Admin browser contexts
                │   ├── claim-data.ts                  # Structured claim payload factories
                │   ├── seedUser.ts                    # User seeding utilities
                │   └── userFactory.ts                 # Dynamic user factory helpers
                ├── admin-status-guardrail.spec.ts     # PW-UI-06: Business rule guardrail (CLOSED option hidden)
                ├── admin-status-transition.spec.ts    # PW-UI-07: Admin status transitions & reload persistence
                ├── auth.spec.ts                       # Authentication & session guardrails
                ├── claimant-status-sync.spec.ts       # PW-UI-08: Cross-role status reflection to Claimant
                ├── claims-submission.spec.ts          # PW-UI-03: Claimant claim submission & toast verification
                ├── claims-workflow.spec.ts            # PW-UI-05: End-to-end Maker-Checker handover workflow
                ├── login-role-redirect.spec.ts        # PW-UI-02: Role-based landing redirection
                ├── login.spec.ts                      # Login validation scenarios
                ├── Login1.spec.ts                     # Supplementary login flow verification
                ├── my-claims-visibility.spec.ts       # PW-UI-04: Submitted claim visibility & data integrity
                ├── security-controls.spec.ts          # PW-UI-10: Invalid login error handling & idle session auto-logout
                └── api/                               # Direct BFF REST API test suite
                    ├── admin-dashboard-reconciliation-api.spec.ts # API-07: Dashboard stats & cache flush reconciliation
                    ├── claim-retrieval-isolation-api.spec.ts      # API-03: Claimant claim retrieval & cross-user isolation
                    ├── claim-status-lifecycle-api.spec.ts         # API-05 / API-06: State machine transitions & cross-role sync
                    ├── logout-api.spec.ts                         # API-10 (API-08): Claimant & Admin logout + 401 revocation
                    ├── maker-checker-rbac-api.spec.ts             # API-04: Admin queue visibility & RBAC 403 guardrails
                    └── negative-auth-security-api.spec.ts         # API-01 / API-02 / API-09: Auth, CSRF, DTO parity & negative auth
```

### 3.2 Engineering Principles Applied (DRY, SOLID, Clean Code)
* **DRY (Don't Repeat Yourself):**
  * Centralized authentication state (`playwright/.auth/claimant.json`, `admin.json`), shared fixtures (`auth.fixture.ts`), reusable factories (`claim-data.ts`, `userFactory.ts`), and shared CSRF token helpers (`getFreshCsrfHeaders`) eliminate duplicated login/setup boilerplate across 31 tests.
  * Page interactions are encapsulated inside `AdminClaimsPage.ts`, `ClaimsPage.ts`, and `LoginPage.ts`.
* **SOLID Principles:**
  * *Single Responsibility:* Each spec file and POM class targets one domain boundary (`AdminClaimsPage.ts` owns `/admin/claims` table locators and status dropdown guardrails; `logout-api.spec.ts` owns session termination and `401` verification).
  * *Open/Closed & Interface Segregation:* Parameterized role cases (`SessionRoleCase`, `TransitionScenario`) allow adding new roles or status transitions without modifying core assertion helpers.
* **Clean Code & Resilient Locators:**
  * User-facing ARIA role locators (`getByRole('heading', { name: 'Claims Management' })`, `getByRole('combobox', { name: 'Update status for claim ...' })`, `getByRole('status')`) replace brittle CSS/XPath selectors.
  * Self-contained data seeding (`POST /api/claims`) guarantees every test creates and mutates its own isolated claim ID without side effects.

---

## 4. Requirement Traceability Matrix (RTM)

### 4.1 Playwright UI Critical Test Suite
| TC ID | Test Case Title | Role / Persona | Priority | Spec File & POM | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PW-UI-02** | End-to-End UI Login & Role-Based Landing Redirection | Claimant & Admin | Critical (P0) | `login-role-redirect.spec.ts` (`LoginPage.ts`) | **Pass** |
| **PW-UI-03** | Claimant Submits New Insurance Claim & Verifies Success Toast | Claimant (Maker) | Critical (P0) | `claims-submission.spec.ts` (`ClaimsPage.ts`) | **Pass** |
| **PW-UI-04** | Submitted Claim Visibility & Data Integrity in 'My Claims' Section | Claimant (Maker) | Critical (P0) | `my-claims-visibility.spec.ts` (`ClaimsPage.ts`) | **Pass** |
| **PW-UI-05** | Maker-Checker Handover: Submitted Claim Visible in Admin Claims Queue | Admin (Checker) | Critical (P0) | `claims-workflow.spec.ts` (`AdminClaimsPage.ts`) | **Defect Logged** *(Bug #1)* |
| **PW-UI-06** | Business Rule Guardrail: `'CLOSED'` Option Hidden for `Submitted` / `Under Review` Claims | Admin (Checker) | Critical (P0) | `admin-status-guardrail.spec.ts` (`AdminClaimsPage.ts`) | **Pass** |
| **PW-UI-07** | Admin Status Transition Workflow: `Submitted` $\rightarrow$ `Under Review` $\rightarrow$ `Approved` / `Rejected` | Admin (Checker) | Critical (P0) | `admin-status-transition.spec.ts` (`AdminClaimsPage.ts`) | **Pass** |
| **PW-UI-08** | Real-Time / Cross-Session Status Sync Reflected to Claimant | Claimant (Maker) | Critical (P0) | `claimant-status-sync.spec.ts` (`ClaimsPage.ts`, `AdminClaimsPage.ts`) | **Pass** |
| **PW-UI-10** | Security Controls: Invalid Login Error Handling & Idle Session Auto-Logout (`page.clock`) | Claimant & Admin | High (P1) | `security-controls.spec.ts` (`LoginPage.ts`) | **Pass** |

### 4.2 BFF API, UI Component & Backend Unit Test Suite
| TC ID | Test Case Title | Role / Persona | Priority | Spec / Test File | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API-01** | Claimant & Admin Login + CSRF Token Handshake (`GET /api/auth/csrf`, `POST /api/auth/login`) | Claimant & Admin | Critical (P0) | `api/negative-auth-security-api.spec.ts` | **Pass** |
| **API-02** | Submit New Insurance Claim & Payload-to-Response Parity (`ClaimResponseDTO`) | Claimant (Maker) | Critical (P0) | `api/negative-auth-security-api.spec.ts` | **Pass** |
| **API-03** | Claimant Claim Retrieval & Cross-User Isolation (`GET /api/claims`, `GET /api/claims/{id}`) | Claimant (Maker) | Critical (P0) | `api/claim-retrieval-isolation-api.spec.ts` | **Pass** |
| **API-04** | Maker-Checker Handover: Admin Queue Visibility & RBAC `403` Guardrail | Admin & Claimant | Critical (P0) | `api/maker-checker-rbac-api.spec.ts` | **Pass** |
| **API-05** | Admin Claim Status State Machine (`newStatus`) & Premature `CLOSED` Transition Guardrail | Admin (Checker) | Critical (P0) | `api/claim-status-lifecycle-api.spec.ts` | **Pass** |
| **API-06** | Cross-Role Status Synchronization to Claimant View (`GET /api/claims/{claimId}`) | Claimant (Maker) | Critical (P0) | `api/claim-status-lifecycle-api.spec.ts` | **Pass** |
| **API-07** | Admin Dashboard Statistics & Cache Flush Reconciliation (`POST /flush-cache`, `GET /stats`) | Admin (Checker) | High (P1) | `api/admin-dashboard-reconciliation-api.spec.ts` | **Pass** |
| **API-09** | Negative Auth Security — Incorrect Username/Password Rejected Properly | Claimant & Admin | High (P1) | `api/negative-auth-security-api.spec.ts` | **Pass** |
| **API-10** | User Logout & Session Invalidation Lifecycle (`POST /api/auth/logout` $\rightarrow$ `401` on subsequent GET) | Claimant & Admin | High (P1) | `api/logout-api.spec.ts` | **Pass** |
| **COMP-01** | Frontend Component Validation Tests (`login-validation.test.tsx`, `theme-picker.test.tsx`) | UI Component | High (P1) | `code/demo-app-ui/tests/unit/*.test.tsx` | **Pass** |
| **UT-01** | Backend `UpdateClaimStatusUseCase` Admin Role Check, CDC/Event Dispatch & Metrics | Backend Domain | High (P1) | `UpdateClaimStatusUseCaseTest.java` | **Pass** |

---

## 5. Application Defects Discovered During Testing

### Defect #1 (Critical Functional Defect): Admin Post-Login Redirect Points to Non-Existent `/admin/dashboard` (`404`)
* **Related Test Case:** `PW-UI-05` (`claims-workflow.spec.ts`)
* **Severity / Priority:** Critical (P0)
* **Description:** When logging in as an Admin (`admin@demo.com`), the Next.js UI or Keycloak login callback redirects to `http://localhost:3001/admin/dashboard`, which returns HTTP **404 (This page could not be found)**.
* **Impact:** Blocks Admin users from landing directly on a valid Admin portal view immediately after login unless they manually navigate to `/admin/claims`.
* **Recommended Remediation:**
  1. Audit `code/demo-app-ui/app/` to align existing Admin route folders (e.g., `/admin` or `/admin/claims`).
  2. Update `code/demo-app-ui/middleware.ts` and the login callback handler (`app/callback` or `app/login`) to redirect Admin users to the valid `/admin/claims` route.

### Defect #2 (Critical Configuration / CORS Defect): `bff-client.ts` Bypasses Next.js Proxy Causing `401` Preflight CORS Failure
* **Related Test Case:** `PW-UI-03` (`claims-submission.spec.ts`)
* **Severity / Priority:** Critical (P0)
* **Description:** Submitting a claim from the UI (`http://localhost:3001`) failed with browser `OPTIONS` preflight CORS errors and `401 Unauthorized` responses.
* **Root Cause:** In `code/demo-app-ui/src/lib/api/bff-client.ts`, the fallback URLs were hardcoded to port `8080`:
  ```ts
  process.env.NEXT_PUBLIC_BFF_STUB_URL || 'http://localhost:8080'
  process.env.NEXT_PUBLIC_BFF_URL || 'http://localhost:8080'
  ```
  Because `NEXT_PUBLIC_BFF_URL` was unset locally, browser requests bypassed the `next.config.ts` proxy on port `3001` and hit `claims-service` directly on `:8080`, stripping `HttpOnly` BFF session cookies.
* **QA Workaround / Environment Fix:** Created `code/demo-app-ui/.env.local` to route all BFF and stub requests cleanly through the Next.js proxy on port `3001`:
  ```env
  NEXT_PUBLIC_BFF_URL=http://localhost:3001
  NEXT_PUBLIC_BFF_STUB_URL=http://localhost:3001
  ```

---

## 6. Local Environment Setup & Technical Challenges Resolved

| # | Area | Challenge Encountered | Root Cause | Engineering Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Backend Unit Tests** | Local build & test alignment in `claims-service` | `UpdateClaimStatusUseCase.java` requires `UserRole.ADMIN` check, `cdcEnabled` flag handling (`Debezium` vs. `ApplicationEventPublisher`), and Micrometer counter verification. | Replaced and aligned `code/claims-service/src/test/java/com/example/demo/application/usecases/UpdateClaimStatusUseCaseTest.java` with the domain use case. |
| **2** | **BFF API Schema** | `PATCH /api/admin/claims/{id}/status` failed with `400 Bad Request` (`"newStatus: must not be null"`) | Test payload sent `{ status: "UNDER_REVIEW" }` instead of `newStatus`. | Updated `claim-status-lifecycle-api.spec.ts` to send `{ newStatus: ... }` and self-seed claims via `POST /api/claims`. |
| **3** | **Session Lifecycle API** | `POST /api/auth/refresh` & `POST /api/auth/logout` failed strict `.toBe(200)` assertions | BFF returns `204 No Content` when rotating/clearing `HttpOnly` cookies via `Set-Cookie`. | Updated `logout-api.spec.ts` to accept `[200, 204]` and verify subsequent protected `GET` requests fail with `401 Unauthorized`. |
| **4** | **Next.js Dev Hydration** | Under full-suite load, `/login` submitted as a native HTML GET (`/login?email=...&password=...`) | Playwright clicked **Log In** before React hydrated the client form handler. | Added `/api/auth/csrf` response wait and `expect(...).toPass()` retry loop in `ensureRoleStorageStates`. |
| **5** | **UI DOM Alignment & Concurrency** | Non-existent `remarks` / `View Details` selectors caused timeouts; multi-worker runs caused Keycloak JWKS `500` errors | UI table renders 8-char Claim IDs and an `Update Status` `<select>` without remarks inputs; parallel workers saturated local JWKS fetches. | Aligned `AdminClaimsPage.ts` & `admin-status-transition.spec.ts` with the rendered DOM and standardized execution on `--workers=1`. |

---

## 7. Execution, Tracing & Consolidated Reporting

### 7.1 Multi-Layer Test Execution Commands
1. **Run Full Playwright E2E + API Suite (31 Tests) & Generate Consolidated Reports** *(from `code/demo-app-ui`)*:
   ```bash
   npx playwright test --workers=1
   ```
2. **Open Consolidated HTML Report (`http://localhost:9323`):**
   ```bash
   npx playwright show-report
   ```
3. **Run Frontend Component Unit Tests** *(from `code/demo-app-ui`)*:
   ```bash
   npm test
   ```
4. **Run Backend Spring Boot Domain Unit Tests** *(from `code/claims-service`)*:
   ```bash
   mvn test
   ```

### 7.2 Playwright Tracing & Failure Diagnostics Strategy
Configured in `code/demo-app-ui/playwright.config.ts`:
* **Trace Capture (`trace: 'on-first-retry'`):** Automatically records DOM snapshots, network HAR logs, console outputs, and step-by-step action timelines into `test-results/**/trace.zip` whenever a test retries.
* **Offline Trace Viewer:**
  ```bash
  npx playwright show-trace test-results/<test-folder>/trace.zip
  ```

### 7.3 Consolidated Report Artifacts
Every Playwright suite run generates self-contained artifacts in `code/demo-app-ui/playwright-report/`:
1. **`playwright-report/index.html`:** Self-contained interactive HTML report (archive or zip the `playwright-report` folder for offline sharing).
2. **`playwright-report/results.xml`:** JUnit XML report for CI/CD pipeline integration (Jenkins, GitHub Actions, GitLab CI).

---

## 8. Future Roadmap (With More Time — Priority Order)

If given additional sprint capacity beyond the 2–3 hour assessment window, the next engineering priorities in order would be:

1. **P1 — Kafka / Debezium CDC Outbox Integration Tests (`Testcontainers`):** Add Spring Boot integration tests verifying that `UpdateClaimStatusUseCase` writes accurate outbox events and publishes to Kafka topics without message loss or duplicate processing.
2. **P1 — WebSocket Real-Time Push Verification:** Extend `claimant-status-sync.spec.ts` to assert live WebSocket frame delivery (`ws://`) so Claimant badges update automatically without requiring a page reload.
3. **P2 — CI/CD GitHub Actions Pipeline & Production Build Execution:** Run Playwright against `npm run build && npm run start` (eliminating dev-mode hydration latency) with parallel worker sharding and automated HTML/trace artifact uploads on failure.
4. **P2 — Contract Testing (Pact / OpenAPI Schema Validation):** Enforce automated OpenAPI contract validation between `demo-app-ui` (`bff-client.ts`) and `bff-service` so DTO field mismatches (`status` vs. `newStatus`) are caught at build time.
5. **P3 — k6 Load & Concurrency Testing:** Benchmark `POST /api/claims` and `PATCH /api/admin/claims/{id}/status` under concurrent Maker-Checker load to verify Keycloak JWKS caching and optimistic locking under contention.

---

## 9. Release Exit Criteria
1. **100% Pass Rate** across all automated Playwright UI & API regression checks (`31/31` passing in `playwright-report/index.html`), frontend unit tests (`npm test`), and backend unit tests (`mvn test`).
2. **Zero Open Critical Security/RBAC Regressions** in CSRF enforcement, Maker-Checker `403` boundaries, and post-logout `401` session revocation.
3. **Defect Resolution Verification:** Fix and verify **Defect #1** (`/admin/dashboard` 404 redirect) and **Defect #2** (`bff-client.ts` default proxy URL) prior to production deployment.