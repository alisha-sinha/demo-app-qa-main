# AI Working Journal — Chubb APAC QA Engineer Take-Home Assessment

**Repository:** `demo-app-qa-main` (`code/demo-app-ui` & `code/claims-service`)  
**Deliverable:** `AI_JOURNAL.md` (AI Collaboration, Engineering Overrides & Walkthrough Notes)  
**Date:** November 22, 2026  
**Automated Test Suite Status:** 31 / 31 Playwright UI & API Scenarios Passing (`playwright-report/index.html`) + Backend & Component Unit Tests  

---

## 1. Executive Summary & AI Governance Approach

### 1.1 Role of AI in This Assessment Sprint
Throughout this take-home assessment, AI was operated strictly as a **pair-programming and diagnostic accelerator**, never as an unverified code generator. Every AI-generated test, Page Object, payload schema, and environment fix was critically reviewed against the actual application source code (`code/demo-app-ui`, `code/claims-service`, `bff-service`) and validated live against the running local stack (`http://localhost:3001` and `http://localhost:8090`).

### 1.2 Core Engineering Guardrails Enforced
1. **Risk-First Prioritisation (2–3 Hour Sprint Discipline):** Directed AI away from low-value boilerplate unit tests toward the highest-risk integration boundaries: Maker-Checker RBAC, CSRF double-submit token handshakes, session cookie invalidation (`HttpOnly`), BFF proxy routing, and claim status state transitions.
2. **Accessible, Resilient Locators Over Brittle CSS:** Enforced Playwright user-facing locators (`getByRole`, `getByLabel`, `getByText`, ARIA `status` roles) in `AdminClaimsPage.ts`, `ClaimsPage.ts`, and `LoginPage.ts`, and eliminated arbitrary `page.waitForTimeout()` calls in favor of deterministic network (`waitForResponse`) and state assertions (`expect.poll`, `toPass`).
3. **Human Verification Against Live Application DOM & API Contracts:** When AI generated assumptions that did not match the live application (such as `remarks` inputs, `View Details` assertions, `status` vs. `newStatus` JSON keys, or HTTP `200` vs. `204` status codes), those outputs were explicitly rejected and corrected based on live stack behavior and screenshots.
4. **Full-Suite Determinism & Isolation:** Identified and resolved full-suite execution hazards—including `.only()` filters masking unexecuted specs, Next.js dev-mode hydration races on `/login`, shared queue data collisions, and Keycloak JWKS `500` contention under multi-worker load (`--workers=1`).

---

## 2. Chronological Prompt, Acceptance & Override Tracker

| ID | Phase / Area | Prompt / Intent Given | AI Output Accepted | AI Output Rejected / Modified | Engineering Rationale (Why) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P-01** | **Local Setup & Backend Domain Alignment** | Align `claims-service` domain test setup (`UpdateClaimStatusUseCaseTest.java`) and resolve `401` preflight CORS error during UI claim submission. | Root-cause trace to `code/demo-app-ui/src/lib/api/bff-client.ts` defaulting to `http://localhost:8080` when `NEXT_PUBLIC_BFF_URL` is unset; clean `.env.local` override pointing both `NEXT_PUBLIC_BFF_URL` and `NEXT_PUBLIC_BFF_STUB_URL` to `http://localhost:3001`. | Rejected modifying application source code (`bff-client.ts`) directly during QA setup in favor of environment-level configuration (`.env.local`) and aligned `UpdateClaimStatusUseCaseTest.java` with `UserRole.ADMIN` and `cdcEnabled` event logic. | Preserves clean separation between QA environment configuration and application source fixes while routing browser requests through the `next.config.ts` proxy so `HttpOnly` cookies are preserved. |
| **P-02** | **Session Lifecycle API (`API-08` / `API-10`)** | Diagnose `POST /api/auth/refresh` failure (`Expected: 200, Received: 204`) and reframe the scenario into a unified **Logout & Session Invalidation** test for both Claimant and Admin (`logout-api.spec.ts`), plus export to Excel. | Parameterized/sequential `APIRequestContext` helper (`verifyLogoutLifecycleForRole`) verifying `200 OK` pre-logout access, CSRF token fetch (`X-XSRF-TOKEN`), `POST /api/auth/logout`, and `401 Unauthorized` post-logout revocation. | **Overrode** AI's initial strict `.toBe(200)` check on auth refresh/logout to accept `[200, 204]`; **rejected** keeping token refresh in the scope when requirements called strictly for a single combined Claimant + Admin logout validation scenario. | Spring Security / BFF clears/rotates `HttpOnly` auth cookies via `Set-Cookie` headers with HTTP `204 No Content` and an empty body; accepting `[200, 204]` while strictly asserting `401` post-logout accurately reflects the BFF contract. |
| **P-03** | **Consolidated Suite Execution & Reporting** | Troubleshoot why `npx playwright test --workers=1` ran only 1 test file instead of all 31 tests and generate a consolidated HTML report. | Diagnostic identification of stray `.only(...)` / `forbidOnly: !!process.env.CI` behavior in local mode, plus consolidated HTML (`playwright-report/index.html`) and JUnit (`results.xml`) reporting commands. | Corrected CLI flag syntax (`--project=chromium` instead of `test=chromium`) and standardized execution on `npx playwright test --workers=1` followed by `npx playwright show-report`. | Locally `CI` is falsy, so a single `.only` silently skips the rest of the suite; running single-worker (`--workers=1`) prevents concurrent Keycloak JWKS `500` timeouts. |
| **P-04** | **Admin Status Lifecycle API (`API-05` / `API-06`)** | Fix `PATCH /api/admin/claims/{claimId}/status` failing with `400 Bad Request` (`"newStatus: must not be null"`) during full-suite execution (`claim-status-lifecycle-api.spec.ts`). | `expect.poll()` retry wrapper for transient JWKS `500` responses and step-by-step status persistence checks (`SUBMITTED` $\rightarrow$ `UNDER_REVIEW` $\rightarrow$ `APPROVED`/`REJECTED`). | **Overrode** AI's initial payload key `{ status: 'UNDER_REVIEW' }` to `{ newStatus: 'UNDER_REVIEW' }`; **rejected** picking arbitrary pre-existing `SUBMITTED` claims from the shared Admin queue in favor of self-seeding a dedicated claim via `POST /api/claims`. | BFF DTO validation strictly requires `newStatus` (`@NotNull`); self-seeding prevents data race collisions when all 31 tests execute sequentially in one run. |
| **P-05** | **Admin UI Transition Workflow (`PW-UI-07`)** | Fix `/login?email=admin%40demo.com&password=...` URL failure under full-suite load and align `admin-status-transition.spec.ts` with the live **Claims Management** UI screenshot (`image_8e012b.jpg`). | Hydration-safe `ensureRoleStorageStates` helper waiting on `/api/auth/csrf` inside `expect(...).toPass()` and locating rows by the 8-character Claim ID prefix (`claimId.slice(0, 8)`). | **Explicitly rejected and removed** AI-generated `remarks` modal input fills and `View Details` link assertions after inspecting the live application UI (`AdminClaimsPage.ts` & screenshot). | Under full-suite CPU load, Next.js dev mode had not hydrated React's `onSubmit` handler before click, causing a native GET form submission. Furthermore, the live UI has no remarks input or `View Details` implementation—keeping dead selectors causes brittle timeouts or false coverage. |
| **P-06** | **Documentation & Deliverable Synthesis** | Generate `TEST_STRATEGY.md` (with `AdminClaimsPage.ts`, full 16-scenario RTM, Defect #1 & #2 logs, and assessment gap closure) and `AI_JOURNAL.md`. | Structured Markdown documents mapping `PW-UI-02`–`PW-UI-10`, `API-01`–`API-10`, `COMP-01`, and `UT-01`, plus DRY/SOLID/Clean Code mapping and Future Roadmap. | Added missing POM file `AdminClaimsPage.ts`, frontend unit test commands (`npm test`), and explicit risk-exclusion rationale to align 100% with the Chubb APAC assessment rubric. | Ensures every artifact (`TEST_STRATEGY.md`, `AI_JOURNAL.md`, Excel matrices, and `playwright-report/`) is internally consistent and walkthrough-ready. |

---

## 3. Deep-Dive Decision Log (Specific Overrides & Course Corrections)

### 3.1 Scope & Architecture Overrides
* **Prioritizing Integration Seams Over Redundant Boilerplate Unit Tests:**
  * *Decision:* Rather than spending sprint hours writing repetitive Java mapper/getter-setter tests (e.g., `ClaimWebMapperTest` or `ArchitectureTest`), testing effort was concentrated on `UpdateClaimStatusUseCaseTest.java` (core domain role/CDC/metrics rules) and building a comprehensive **31-test Playwright E2E + BFF API suite** (`code/demo-app-ui/tests/e2e/`).
  * *Why:* The highest failure probability in a Next.js + Spring Boot BFF + Claims Service + Keycloak architecture lies at the **integration seams**—CSRF headers, `HttpOnly` cookie forwarding, proxy routing, and Maker-Checker RBAC enforcement—not in trivial DTO field mappings.
* **Self-Contained Data Seeding vs. Shared Static Fixtures:**
  * *Decision:* Overrode initial API and UI lifecycle specs that queried `GET /api/admin/claims` for *any* existing `SUBMITTED` claim. Instead, `claim-status-lifecycle-api.spec.ts` and `admin-status-transition.spec.ts` dynamically seed their own isolated claim via `POST /api/claims` as Claimant before switching to Admin.
  * *Why:* In a consolidated 31-test run, earlier tests (`admin-status-guardrail.spec.ts`, `maker-checker-rbac-api.spec.ts`) also read or transition claims in the Admin queue. Dynamic seeding guarantees zero cross-test state contamination.

### 3.2 Code & Structure Fixes (AI Output Corrections)
1. **Corrected Request DTO Field Name (`status` $\rightarrow$ `newStatus`):**
   * *Issue:* AI initially generated `PATCH /api/admin/claims/${claimId}/status` with `{ status: 'UNDER_REVIEW' }`, triggering HTTP `400 Validation Error: ["newStatus: must not be null"]`.
   * *Fix:* Updated both transition payloads in `claim-status-lifecycle-api.spec.ts` to `{ newStatus: 'UNDER_REVIEW' }` and `{ newStatus: FINAL_DECISION }`.
2. **Removed Hallucinated / Non-Existent UI Elements (`remarks` & `View Details`):**
   * *Issue:* AI added confirmation dialog `remarks` textbox fills and `View Details` link assertions in `admin-status-transition.spec.ts`.
   * *Fix:* Removed both based on actual application inspection—the **Claims Management** table (`AdminClaimsPage.ts`) uses an 8-character Claim ID (`code`), an ARIA `status` badge (`Claim status: <status>`), and an `Update status for claim <claimId>` `combobox` without remarks inputs or `View Details` navigation.
3. **HTTP `204 No Content` Handling on Auth Endpoints:**
   * *Issue:* AI asserted `.toBe(200)` on `POST /api/auth/refresh` and `POST /api/auth/logout`, causing 30-second `expect.poll` timeouts when the BFF returned `204 No Content`.
   * *Fix:* Updated `logout-api.spec.ts` to assert `expect([200, 204]).toContain(logoutRes.status())`, followed by a strict `expect(postLogoutRes.status()).toBe(401)` on subsequent protected `GET` calls.
4. **Next.js Dev Hydration Race Fix (`/login?email=...&password=...`):**
   * *Issue:* Under full-suite CPU load, Playwright filled `/login` and clicked submit before React attached its client `onSubmit` handler, causing the browser to execute a native GET form submission that leaked credentials into the query string and never redirected.
   * *Fix:* Updated `ensureRoleStorageStates` to wait for `GET /api/auth/csrf` and wrap login submission inside an `expect(async () => { ... }).toPass({ timeout: 45_000 })` retry block.
5. **Single-Worker Stabilization (`--workers=1`) & `expect.poll` JWKS Resilience:**
   * *Issue:* Running multiple parallel Playwright workers against the local Docker stack caused transient HTTP `500` errors on protected BFF `GET` calls due to Keycloak JWKS fetch contention.
   * *Fix:* Standardized full-suite execution on `npx playwright test --workers=1` and added bounded `expect.poll` retries on post-login protected API requests.

### 3.3 Environment & Infrastructure Workarounds
* **CORS Preflight `401` Bypass (`bff-client.ts` $\rightarrow$ `.env.local`):**
  * *Diagnosis:* UI claim submissions (`POST /api/claims`) failed with browser `OPTIONS` preflight CORS errors and `401 Unauthorized` because `code/demo-app-ui/src/lib/api/bff-client.ts` fell back to `http://localhost:8080` when `NEXT_PUBLIC_BFF_URL` was undefined—bypassing the `next.config.ts` proxy on `:3001` and stripping `HttpOnly` session cookies.
  * *Workaround:* Created `code/demo-app-ui/.env.local` setting `NEXT_PUBLIC_BFF_URL=http://localhost:3001` and `NEXT_PUBLIC_BFF_STUB_URL=http://localhost:3001`, and logged the hardcoded `:8080` fallback as **Defect #2** in `TEST_STRATEGY.md`.
* **Backend Domain Unit Test Alignment (`UpdateClaimStatusUseCaseTest.java`):**
  * *Diagnosis:* Verified `UpdateClaimStatusUseCase.java` enforces `UserRole.ADMIN`, branches between Debezium CDC (`cdcEnabled=true`) and direct `ApplicationEventPublisher` event publishing (`cdcEnabled=false`), and increments the Micrometer `claims.status.changed` counter.
  * *Resolution:* Updated `UpdateClaimStatusUseCaseTest.java` in `code/claims-service` so backend unit tests compile and validate all domain invariants cleanly.

---

## 4. Test Coverage & Defect Discovery Summary

### 4.1 Automated Test Coverage Mapped to High-Risk Areas (31 Playwright E2E/API + Unit/Component)
| Risk Area | Automated Spec / Test Files | Key Validations Covered |
| :--- | :--- | :--- |
| **1. Auth, Session Cookies, CSRF & Logout Revocation** | `login-role-redirect.spec.ts`, `login.spec.ts`, `Login1.spec.ts`, `auth.spec.ts`, `security-controls.spec.ts`, `api/negative-auth-security-api.spec.ts`, `api/logout-api.spec.ts`, `tests/unit/login-validation.test.tsx` | `GET /api/auth/csrf` + `X-XSRF-TOKEN` double-submit handshake; invalid credential rejection (`401` + UI error alert); idle session auto-logout via `page.clock`; `POST /api/auth/logout` (`200`/`204`) revoking subsequent `GET /api/claims` & `GET /api/admin/claims` (`401`). |
| **2. Maker-Checker RBAC & Cross-User Data Isolation** | `claims-workflow.spec.ts`, `my-claims-visibility.spec.ts`, `api/claim-retrieval-isolation-api.spec.ts`, `api/maker-checker-rbac-api.spec.ts` | Claimant personal queue isolation (`GET /api/claims`); `403 Forbidden` enforcement when Claimant invokes `/api/admin/claims` or `PATCH /api/admin/claims/{id}/status`; Admin full-queue visibility. |
| **3. Claim Lifecycle State Machine & Business Guardrails** | `claims-submission.spec.ts`, `admin-status-guardrail.spec.ts`, `admin-status-transition.spec.ts`, `api/claim-status-lifecycle-api.spec.ts`, `UpdateClaimStatusUseCaseTest.java` | Payload-to-response DTO parity; sequential `Submitted` $\rightarrow$ `Under Review` $\rightarrow$ `Approved`/`Rejected` transitions (`newStatus`); UI & API guardrails preventing premature jump to `CLOSED` from `Submitted`/`Under Review`; reload badge persistence. |
| **4. Cross-Role Sync & Dashboard Cache Reconciliation** | `claimant-status-sync.spec.ts`, `api/admin-dashboard-reconciliation-api.spec.ts` | Cross-session reflection of Admin adjudication decisions (`Approved`/`Rejected`) in Claimant's view; `POST /api/admin/dashboard/flush-cache` + `GET /api/admin/dashboard/stats` reconciliation against `/api/admin/claims` & `/api/admin/users`. |

### 4.2 Application Defects & Gaps Uncovered
1. **Defect #1 (Critical — P0): Admin Post-Login Redirect Points to Non-Existent `/admin/dashboard` (`404`)**
   * *Discovered In:* `PW-UI-05` (`claims-workflow.spec.ts`).
   * *Details:* Logging in as `admin@demo.com` redirects to `http://localhost:3001/admin/dashboard`, returning HTTP **404 (This page could not be found)** instead of the valid `/admin/claims` route.
2. **Defect #2 (Critical — P0): `bff-client.ts` Default URL Bypasses Next.js Proxy (`401` Preflight CORS Failure)**
   * *Discovered In:* `PW-UI-03` (`claims-submission.spec.ts`).
   * *Details:* `code/demo-app-ui/src/lib/api/bff-client.ts` defaults to `http://localhost:8080` when `NEXT_PUBLIC_BFF_URL` is unset, bypassing the `:3001` Next.js proxy, triggering browser CORS preflight failures, and dropping `HttpOnly` BFF session cookies. Mitigated locally via `.env.local`.
3. **Defect / Schema Finding #3 (Contract Strictness): `PATCH /api/admin/claims/{id}/status` Requires `newStatus` & Returns `204` on Auth Mutations**
   * *Details:* Confirmed that the BFF rejects `status` with `400 Bad Request` (`newStatus: must not be null`) and returns `204 No Content` (empty body) on `/api/auth/logout` and `/api/auth/refresh`, requiring contract alignment between frontend/QA clients and BFF DTOs.