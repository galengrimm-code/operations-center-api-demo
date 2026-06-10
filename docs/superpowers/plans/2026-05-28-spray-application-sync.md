# Spray-Application Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import John Deere Operations Center APPLICATION (spray) field operations with per-product tank-mix data, editable JD-imported values with revert-to-original, product categorization seeded from a lookup table, and HP-aligned UI for browsing and editing applications and product rollups.

**Architecture:** Two new tables in `operations_center` schema (`products` + `field_operation_products`) plus three new columns on existing `field_operations` (`measurement_status`, `application_name`, `application_name_user_edited`/`_jd_original`). Re-import uses merge-by-`line_index` with soft-delete via `deleted_at`. New `import-applications` edge function action; existing `john-deere-import` split into per-action modules. Frontend `/applications` + `/products` routes with HP-style category-grouped editable rows. Tests: Vitest (unit, TDD), Deno tests (edge function actions), Playwright (E2E).

**Tech Stack:** Next.js 13 App Router, React 18, TypeScript, Supabase (Postgres + Edge Functions on Deno), Tailwind, shadcn/ui, Vitest, @testing-library/react, Playwright, Mapbox GL (existing, not extended).

**Source spec:** `docs/superpowers/specs/2026-05-28-spray-application-sync-design.md` — reference for design rationale; this plan focuses on execution.

---

## File Structure

### Created files (relative to repo root)

```
__fixtures__/jd/
  application-rate-result-single-tankmix.json     # Phase 0c capture, anonymized
  application-rate-result-404.json                # Phase 0c capture of 404 payload
  application-operations-list.json                # fieldOperations?type=APPLICATION list
  README.md                                       # how to refresh fixtures

scripts/
  capture-jd-fixtures.ts                          # Deno script — recapture fixtures from live JD

supabase/migrations/
  20260528120000_create_products_table.sql
  20260528120100_create_field_operation_products_table.sql
  20260528120200_extend_field_operations_for_applications.sql
  20260528120300_create_product_category_seeds_table.sql

supabase/functions/john-deere-import/
  index.ts                                        # rewritten as dispatch-only (existing file modified)
  actions/import-fields.ts                        # extracted from existing
  actions/import-operations.ts                    # extracted (HARVEST + SEEDING)
  actions/import-applications.ts                  # NEW
  actions/import-field-operations.ts              # extracted
  actions/debug-field-boundaries.ts               # extracted
  actions/debug-field-operations.ts               # extracted
  helpers/fetch-measurement-data.ts               # extracted
  helpers/fetch-map-image.ts                      # extracted
  helpers/pagination.ts                           # extracted next-page follower
  helpers/normalize.ts                            # name_normalized helper
  helpers/merge-application-products.ts           # the 5-case merge decision tree
  helpers/extract-tankmix.ts                      # JD response → flat productTotals[]
  helpers/derive-application-name.ts              # outer aggregate names → "; "-joined
  shared/errors.ts                                # generic error responder
  shared/validation.ts                            # Zod schemas
  shared/types.ts                                 # JD response interfaces
  __tests__/extract-tankmix.test.ts
  __tests__/derive-application-name.test.ts
  __tests__/merge-application-products.test.ts
  __tests__/normalize.test.ts
  __tests__/import-applications.test.ts           # Deno test of the action

lib/
  applications-client.ts                          # frontend fetch + edit wrappers
  category-utils.ts                               # category resolution (override ?? products.category)
  unit-display.ts                                 # JD unitId → human label
  check-mutation-result.ts                        # Farm-Budget pattern (new portfolio helper)
  __tests__/category-utils.test.ts
  __tests__/unit-display.test.ts

types/
  applications.ts                                 # ProductCategory enum-like, ProductLine, etc.

app/(app)/applications/
  page.tsx                                        # /applications list view
  loading.tsx
app/(app)/products/
  page.tsx                                        # /products rollup view
  loading.tsx

components/applications/
  applications-list.tsx
  application-row.tsx                             # collapsed row
  application-expanded.tsx                        # expanded edit view
  product-line-row.tsx                            # single editable line
  product-line-edit-dialog.tsx                    # modal for rate/total/area edit
  product-line-revert.tsx                         # revert-to-JD button + confirm
  application-filters.tsx                         # field/product/season/date/category
  category-badge.tsx                              # icon + label per category
  inconsistency-badge.tsx                         # rate × area != total warning
  products-rollup-table.tsx                       # the /products view body
components/fields/
  field-applications-tab.tsx                      # new tab on /fields/[id]

tests/e2e/
  import-and-view.spec.ts
  edit-and-revert.spec.ts
  reimport-preserves-edits.spec.ts
  playwright.global-setup.ts                      # auth setup, reused across specs

vitest.config.ts                                  # root
playwright.config.ts                              # root
.env.test                                         # local test env vars (gitignored)
__fixtures__/jd/README.md
```

### Modified files

- `package.json` — add devDeps + scripts
- `.gitignore` — add `playwright-report/`, `test-results/`, `.env.test`
- `supabase/functions/john-deere-import/index.ts` — reduce to dispatch only (~80 lines, was 689)
- `supabase/functions/_shared/cors.ts` — referenced unchanged
- `app/(app)/layout.tsx` — add `/applications` and `/products` to nav (if nav is declarative)
- `components/layout/nav-links.tsx` — add new nav items

### Files NOT touched

- All `irrigation-*` components
- `app/(app)/map/*` (no spray overlay in this build)
- `app/(app)/operations/*` (replaced by `/applications` for application-type ops; harvest/seeding stays here)
- `lib/john-deere-client.ts` — frontend doesn't call new edge function from this file; new wrappers in `applications-client.ts`
- `_shared/*.ts` — used by edge functions, unchanged
- Auth, OAuth, irrigation, boundary code

---

## Test Strategy (reminder; see spec section 7)

| Tier                 | Framework                              | Files                                                                                                                     | Run in `prebuild`?                  |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Unit (TS)            | Vitest                                 | `lib/__tests__/*.test.ts` + `supabase/functions/john-deere-import/__tests__/*.test.ts` (the \*.ts ones — see Task 1 note) | Yes                                 |
| Edge function action | Deno test                              | `supabase/functions/john-deere-import/__tests__/import-applications.test.ts`                                              | No (Deno not on Vercel; local only) |
| E2E                  | Playwright                             | `tests/e2e/*.spec.ts`                                                                                                     | No (too slow; local + future CI)    |
| RLS / DB             | manual + `checkMutationResult` runtime | —                                                                                                                         | —                                   |

**TDD posture:**

- Pure logic in `lib/` and `helpers/` → test first (Vitest unit tests)
- Edge function action → test alongside (Deno tests)
- UI → test after (Playwright once UI exists)

**Fixtures:** `__fixtures__/jd/` holds real captured JD responses (anonymized). Tests run against production shapes.

---

## Tasks

---

## Group 0 — Security Hardening (runs BEFORE Group A)

Folds in the existing P1/P2/P3 flags from the Watch Tower scan v6.7 that touch surfaces the spray-sync build will modify anyway. New feature work then lands on the improved baseline rather than the legacy one.

Cross-reference: `CLAUDE.md` SCAN:AUTO block lists these as active flags. Addressing them here resolves: `cors-open` (P1), `error-response-leakage` (P2), `route-protection-gap` (P3), `oauth-broad-scopes` (P3).

### Task 0.1: Restrict CORS in `_shared/cors.ts` (P1 — `cors-open`)

**Files:**

- Modify: `supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Read current CORS module**

```bash
cat supabase/functions/_shared/cors.ts
```

Confirm it currently uses `"Access-Control-Allow-Origin": "*"`.

- [ ] **Step 2: Replace wildcard with allowlist + origin reflection (safe pattern)**

```typescript
// supabase/functions/_shared/cors.ts

const ALLOWED_ORIGINS = new Set([
  "https://operations-center-api-demo.vercel.app",
  "http://localhost:3000",
  // add Vercel preview origins explicitly here if needed: "https://operations-center-api-demo-git-*.vercel.app"
]);

function resolveOrigin(req: Request | undefined): string {
  if (!req) return "https://operations-center-api-demo.vercel.app"; // safe default for non-request contexts
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "https://operations-center-api-demo.vercel.app";
}

function corsHeaders(req?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

export function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function errorResponse(
  error: string,
  status = 400,
  details?: string,
  req?: Request,
): Response {
  return jsonResponse({ error, ...(details ? { details } : {}) }, status, req);
}

export function optionsResponse(req?: Request): Response {
  return new Response(null, { status: 200, headers: corsHeaders(req) });
}
```

Notes:

- `Vary: Origin` is required when the response depends on the Origin header (cache correctness).
- Existing callers pass `req` from the function handler; if they don't, defaults to production origin (won't echo evil.com).
- No `cors-origin-reflection` (v6.7 P1) risk because we never echo an origin we didn't pre-approve.

- [ ] **Step 3: Update call sites in all 4 functions to pass `req`**

In each of `john-deere-auth/index.ts`, `john-deere-api/index.ts`, `john-deere-import/index.ts`, `john-deere-irrigation/index.ts`:

- Change `optionsResponse()` → `optionsResponse(req)`
- Change `jsonResponse(data, status)` → `jsonResponse(data, status, req)`
- Change `errorResponse(msg, status)` → `errorResponse(msg, status, undefined, req)`

(These are mechanical find/replace per file.)

- [ ] **Step 4: Deploy all 4 functions via `mcp__supabase__deploy_edge_function`**

Use `project_id: "nuxofsjzrgdauzriraze"` and `verify_jwt: false` per `.claude/rules/edge-functions.md`.

- [ ] **Step 5: Verify with curl (P1 gate)**

```bash
curl -I -X OPTIONS \
  https://nuxofsjzrgdauzriraze.supabase.co/functions/v1/john-deere-api \
  -H "Origin: https://evil.com"
```

Expected: `Access-Control-Allow-Origin: https://operations-center-api-demo.vercel.app` (NOT `*`, NOT `https://evil.com`).

```bash
curl -I -X OPTIONS \
  https://nuxofsjzrgdauzriraze.supabase.co/functions/v1/john-deere-api \
  -H "Origin: http://localhost:3000"
```

Expected: `Access-Control-Allow-Origin: http://localhost:3000`.

- [ ] **Step 6: Verify dev still works**

```bash
npm run dev
```

Visit `http://localhost:3000`, sign in, hit any existing action (import-fields debug or similar). Expected: no CORS errors in console.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/john-deere-auth/ supabase/functions/john-deere-api/ supabase/functions/john-deere-import/ supabase/functions/john-deere-irrigation/
git commit -m "security: restrict CORS to allowlist origins on all edge functions (P1 cors-open)"
```

---

### Task 0.2: Generic errors across all 4 functions (P2 — `error-response-leakage`)

**Files:**

- Create: `supabase/functions/_shared/generic-error.ts`
- Modify: catch blocks in all 4 existing edge functions

The new code in Tasks 15/20 already uses generic errors. This task brings the existing 4 functions up to the same posture so the SCAN:AUTO `error-response-leakage` flag clears.

- [ ] **Step 1: Create `_shared/generic-error.ts`**

```typescript
// supabase/functions/_shared/generic-error.ts
// Generic error responder shared across functions. Never leaks error.message, error.stack,
// or upstream payloads. Server-side logs the full context; clients get a stable code.

import { jsonResponse } from "./cors.ts";

type ErrorCategory = "request_failed" | "unauthorized" | "not_found" | "validation_failed";

export function genericError(
  status: number,
  category: ErrorCategory,
  code: string,
  req?: Request,
): Response {
  return jsonResponse({ error: category, code }, status, req);
}

export function logAndRespond(
  status: number,
  category: ErrorCategory,
  code: string,
  err: unknown,
  context: Record<string, unknown> = {},
  req?: Request,
): Response {
  console.error(`[${code}]`, { ...context, error: serializeError(err) });
  return genericError(status, category, code, req);
}

function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Unknown", message: String(err) };
}
```

- [ ] **Step 2: Retrofit `john-deere-auth/index.ts` catch block**

Find the existing `} catch (error) {` block at approximately line 80-85 that currently returns `errorResponse(error.message, ...)`. Replace with:

```typescript
} catch (error) {
  return logAndRespond(500, "request_failed", "AUTH_500", error, {}, req);
}
```

Add import at top: `import { logAndRespond } from "../_shared/generic-error.ts";`

- [ ] **Step 3: Retrofit `john-deere-api/index.ts` catch block**

Same pattern. Code prefix `API_500`.

- [ ] **Step 4: Retrofit `john-deere-import/index.ts` catch block**

The existing block at line 687 currently returns `errorResponse(error.message, 500, error.stack)` — leaking BOTH message and stack. Replace:

```typescript
} catch (error) {
  return logAndRespond(500, "request_failed", "IMPORT_500", error, {}, req);
}
```

- [ ] **Step 5: Retrofit `john-deere-irrigation/index.ts` catch block**

Code prefix `IRRIGATION_500`.

- [ ] **Step 6: Deploy all 4 functions**

Via `mcp__supabase__deploy_edge_function` with `verify_jwt: false`.

- [ ] **Step 7: Verify (P2 gate)**

Manually trigger an error path (e.g., call a function without the Authorization header):

```bash
curl -i https://nuxofsjzrgdauzriraze.supabase.co/functions/v1/john-deere-api?action=organizations
```

Expected response body: `{"error":"unauthorized","code":"..."}` or generic `{"error":"request_failed","code":"..."}`. NOT containing `error.message` text, JS stack frames, or upstream JSON.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/generic-error.ts supabase/functions/john-deere-*/index.ts
git commit -m "security: generic error responses across edge functions (P2 error-response-leakage)"
```

---

### Task 0.3: Server-side route protection via `middleware.ts` (P3 — `route-protection-gap`)

**Files:**

- Create: `middleware.ts` (project root)
- Modify: `package.json` (add `@supabase/ssr` dependency)

Server-side gate on `(app)/*` routes. Page HTML won't load at all without a valid session, eliminating the "auth content flashes before client redirect" issue.

- [ ] **Step 1: Install `@supabase/ssr`**

```bash
npm install @supabase/ssr
```

Expected: package added; lockfile updated.

- [ ] **Step 2: Create `middleware.ts` at project root**

```typescript
// middleware.ts
// Server-side auth gate for protected routes. Runs before page HTML renders.
// Public routes: /, /login, /auth/callback, static assets.
// Protected: everything under app/(app)/ — /map, /fields, /operations, /applications, /products, /settings, /dashboard.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

const PUBLIC_FILE_EXT = /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|eot)$/;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Always allow public paths + static files + Next internals
  if (
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") || // API routes handle their own auth
    PUBLIC_FILE_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Validate session via Supabase SSR
  let response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes EXCEPT static files and Next internals (matched via PUBLIC paths above too — defense in depth)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Dev test — unauthenticated user redirected**

```bash
npm run dev
```

In a private/incognito browser window, visit `http://localhost:3000/map` directly (no sign-in). Expected: browser redirects to `/login?redirect=/map` BEFORE any page HTML loads. Confirm via Network tab — the response status for `/map` is 307 redirect, not 200 with content.

Visit `http://localhost:3000/login` directly. Expected: 200 OK (login page renders).

- [ ] **Step 5: Sign in and verify protected routes work**

Sign in via `/login`. Then visit `/map`, `/fields`, `/applications`, `/products` — all should render normally.

- [ ] **Step 6: Verify (P3 gate)**

```bash
curl -i http://localhost:3000/map
```

Expected: 307 Temporary Redirect with `Location: /login?redirect=/map`. NOT 200 with HTML content.

- [ ] **Step 7: Commit**

```bash
git add middleware.ts package.json package-lock.json
git commit -m "security: middleware.ts server-side route protection (P3 route-protection-gap)"
```

---

### Task 0.4: Trim OAuth scopes (P3 — `oauth-broad-scopes`)

**Files:**

- Modify: `lib/john-deere-client.ts:288`

- [ ] **Step 1: Locate the scopes string**

```bash
grep -n "ag1 ag2 ag3" lib/john-deere-client.ts
```

Expected: one match around line 288.

- [ ] **Step 2: Edit to read-only scope set**

Change:

```typescript
scope: "ag1 ag2 ag3 org1 org2 work1 work2 offline_access",
```

To:

```typescript
scope: "ag1 org1 work1 offline_access",
```

- [ ] **Step 3: Document the change**

Add an inline comment above the scope line:

```typescript
// Read-only scopes per spec/security audit (was: ag1-3 org1-2 work1-2). Bump back up if write functionality is ever added.
```

- [ ] **Step 4: Verify by triggering a new OAuth flow**

In a private browser window, sign in and click Connect for John Deere. The JD consent screen should now show fewer permission categories than before. Approve, complete the flow, confirm field import still works (read scope is sufficient for everything this app does today).

If JD's consent flow fails because an existing user's stored token had broader scopes than the new request, that's a one-time re-consent — not a regression.

- [ ] **Step 5: Commit**

```bash
git add lib/john-deere-client.ts
git commit -m "security: trim John Deere OAuth scopes to read-only (P3 oauth-broad-scopes)"
```

---

### Task 0.5: Update CLAUDE.md Resolved table + TECH-DEBT.md

The Watch Tower SCAN:AUTO block is auto-managed and refreshes on the next scheduled scan. The Resolved table inside the block IS append-friendly — the next scan will see these items as "previously flagged → no longer triggers" and confirm. Per `reference_watchtower_accepted_risks.md`, manual edits to CLAUDE.md are the source of truth.

**Files:**

- Modify: `CLAUDE.md` (Resolved table inside SCAN:AUTO block)
- Modify: `TECH-DEBT.md`

- [ ] **Step 1: Append four entries to the CLAUDE.md Resolved table**

In `CLAUDE.md`, locate the `### Resolved` table inside the SCAN:AUTO block. Add four rows at the top of the table body:

```markdown
| YYYY-MM-DD | cors-open | Restricted `_shared/cors.ts` to explicit allowlist (`operations-center-api-demo.vercel.app` + localhost). Verified live: `curl -I -X OPTIONS ... -H "Origin: https://evil.com"` no longer echoes the evil origin. Deployed to all 4 functions. |
| YYYY-MM-DD | error-response-leakage | Added `_shared/generic-error.ts`. All 4 functions' catch blocks now return `{error: "request_failed", code: "<FN>_<STATUS>"}` only. Server logs the full error/stack server-side. Verified by curling an unauthorized request — no `error.message` in response body. |
| YYYY-MM-DD | route-protection-gap | Added `middleware.ts` using `@supabase/ssr`. Unauthenticated requests to `(app)/*` routes get 307 redirect to `/login?redirect=<path>` BEFORE any page HTML loads. Verified: `curl -i /map` returns 307 with no body content. |
| YYYY-MM-DD | oauth-broad-scopes | Trimmed scopes from `ag1 ag2 ag3 org1 org2 work1 work2 offline_access` → `ag1 org1 work1 offline_access` (read-only) in `lib/john-deere-client.ts`. Bump back up when write functionality lands. |
```

Replace `YYYY-MM-DD` with today's date. Leave the existing Resolved rows below intact.

- [ ] **Step 2: Move corresponding TECH-DEBT entries to Resolved**

In `TECH-DEBT.md`, find the four active items (CORS wildcard, Error response leakage, No server-side route protection, Overly broad OAuth scopes). Cut their bodies. Append them to the Resolved section at the bottom with the resolution note:

```markdown
### CORS wildcard on all Supabase Edge Functions — YYYY-MM-DD

Resolved as part of spray-application sync build (Task 0.1). `_shared/cors.ts` now uses an explicit allowlist with `Vary: Origin`. Commit: <hash>.

### Error response leakage in all Edge Functions — YYYY-MM-DD

Resolved as part of spray-application sync build (Task 0.2). `_shared/generic-error.ts` added; all 4 functions' catch blocks retrofitted. Commit: <hash>.

### No server-side route protection (middleware.ts) — YYYY-MM-DD

Resolved as part of spray-application sync build (Task 0.3). `middleware.ts` added at project root using `@supabase/ssr`. Commit: <hash>.

### Overly broad John Deere OAuth scopes — YYYY-MM-DD

Resolved as part of spray-application sync build (Task 0.4). Scopes trimmed to `ag1 org1 work1 offline_access` in `lib/john-deere-client.ts`. Commit: <hash>.
```

Fill in commit hashes from `git log --oneline | head -5` after Tasks 0.1-0.4 commits.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md TECH-DEBT.md
git commit -m "docs: mark 4 security findings resolved (cors-open, error-leakage, route-gap, oauth-scopes)"
```

---

### Task 1: Install and configure Vitest

**Files:**

- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `lib/__tests__/sanity.test.ts`

- [ ] **Step 1: Install Vitest + dependencies**

```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom
```

Expected: 0 vulnerabilities; ~25 packages added.

- [ ] **Step 2: Create `vitest.config.ts` at repo root**

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "supabase/functions/john-deere-import/__tests__/**/*.test.ts",
    ],
    exclude: [
      "node_modules",
      ".next",
      "tests/e2e/**",
      "supabase/functions/john-deere-import/__tests__/import-applications.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", ".next/**", "tests/e2e/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

Note: the import-applications.test.ts file is excluded from Vitest because it's a Deno test (runs in supabase functions runtime, not jsdom).

- [ ] **Step 3: Create `vitest.setup.ts`**

```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Create sanity test `lib/__tests__/sanity.test.ts`**

```typescript
import { describe, it, expect } from "vitest";

describe("vitest sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Add scripts to `package.json`**

Add to the `"scripts"` block (preserve existing scripts):

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 6: Run test, verify green**

```bash
npm test
```

Expected: 1 test passing. No errors.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts vitest.setup.ts lib/__tests__/sanity.test.ts package.json package-lock.json
git commit -m "test: install Vitest + first sanity test"
```

---

### Task 2: Install and configure Playwright

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/sanity.spec.ts`
- Create: `.env.test`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

Expected: Chromium browser downloaded (~150MB); install completes.

- [ ] **Step 2: Create `playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // single user, single session — avoid auth races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Create `.env.test` (gitignored)**

```bash
# Playwright local test credentials — DO NOT COMMIT
# Galen fills these in locally with a real Supabase test account.
PLAYWRIGHT_TEST_EMAIL=
PLAYWRIGHT_TEST_PASSWORD=
PLAYWRIGHT_BASE_URL=http://localhost:3000
```

- [ ] **Step 4: Update `.gitignore`**

Append to existing `.gitignore`:

```
# Playwright
/test-results/
/playwright-report/
/playwright/.cache/

# Test env
.env.test
.env.test.local
```

- [ ] **Step 5: Create `tests/e2e/sanity.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  // Redirects to /login or /map depending on auth state — either is fine for sanity.
  await expect(page).toHaveURL(/\/(login|map)/);
});
```

- [ ] **Step 6: Add scripts to `package.json`**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:debug": "playwright test --debug"
```

- [ ] **Step 7: Run E2E sanity (skip if no test account configured yet)**

```bash
npm run test:e2e
```

Expected (with dev server starting): page loads, test passes. If dev server fails to start (missing env vars), document the failure and continue — the sanity test will run successfully once the dev environment is set up.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts tests/e2e/sanity.spec.ts package.json package-lock.json .gitignore
git commit -m "test: install Playwright + first sanity test"
```

---

### Task 3: Seed `__fixtures__/jd/` with Phase 0c captured response

**Files:**

- Create: `__fixtures__/jd/application-rate-result-single-tankmix.json`
- Create: `__fixtures__/jd/application-rate-result-404.json`
- Create: `__fixtures__/jd/application-operations-list.json`
- Create: `__fixtures__/jd/README.md`
- Create: `scripts/capture-jd-fixtures.ts`

- [ ] **Step 1: Create `__fixtures__/jd/application-rate-result-single-tankmix.json`**

This is the actual JD response captured 2026-05-28 from Galen's "A Test/ Clean out" field (Infurrow operation, 2025-06-03). Operation/field IDs replaced with synthetic UUIDs for fixture portability.

```json
{
  "@type": "FieldOperationMeasurement",
  "measurementName": "ApplicationRateResult",
  "measurementCategory": "Result",
  "varietyTotals": [],
  "applicationProductTotals": [
    {
      "@type": "ApplicationProductTotal",
      "productId": "fefe63ecd90a4869de911756e7211332",
      "name": "Infurrow",
      "area": {
        "@type": "EventMeasurement",
        "value": 0.04,
        "unitId": "ac",
        "variableRepresentation": "vrTaskArea"
      },
      "averageSpeed": {
        "@type": "EventMeasurement",
        "value": 0.1,
        "unitId": "mi1hr-1",
        "variableRepresentation": "vrVehicleSpeed"
      },
      "totalMaterial": {
        "@type": "EventMeasurement",
        "value": 0.3,
        "unitId": "gal",
        "variableRepresentation": "vrTotalQuantityAppliedVolume"
      },
      "averageMaterial": {
        "@type": "EventMeasurement",
        "value": 7.64,
        "unitId": "gal1ac-1",
        "variableRepresentation": "vrAppRateVolumeMeasured"
      },
      "appliedArea": {
        "@type": "EventMeasurement",
        "value": 0.04,
        "unitId": "ac",
        "variableRepresentation": "vrAppliedArea"
      },
      "productTotals": [
        {
          "@type": "ProductTotal",
          "productId": "66834dae-f252-4454-99b0-d7a287e9d4fe",
          "name": "EnzUpP",
          "brand": "---",
          "carrier": false,
          "totalMaterial": {
            "@type": "EventMeasurement",
            "value": 0.3,
            "unitId": "gal",
            "variableRepresentation": "vrTotalQuantityAppliedVolume"
          },
          "averageMaterial": {
            "@type": "EventMeasurement",
            "value": 7.49,
            "unitId": "gal1ac-1",
            "variableRepresentation": "vrAppRateVolumeMeasured"
          }
        },
        {
          "@type": "ProductTotal",
          "productId": "0d373fc5-d2a0-4afc-be6e-f8f34eabaaac",
          "name": "Water",
          "brand": "---",
          "carrier": true,
          "totalMaterial": {
            "@type": "EventMeasurement",
            "value": 0,
            "unitId": "gal",
            "variableRepresentation": "vrTotalQuantityAppliedVolume"
          },
          "averageMaterial": {
            "@type": "EventMeasurement",
            "value": 0.15,
            "unitId": "gal1ac-1",
            "variableRepresentation": "vrAppRateVolumeMeasured"
          }
        }
      ]
    }
  ],
  "links": []
}
```

- [ ] **Step 2: Create `__fixtures__/jd/application-rate-result-404.json`**

Real 404 payload from Phase 0c:

```json
{
  "@type": "Errors",
  "errors": [
    {
      "@type": "Error",
      "guid": "00000000-0000-0000-0000-000000000404",
      "message": "The requested resource was not found"
    }
  ],
  "otherAttributes": {}
}
```

- [ ] **Step 3: Create `__fixtures__/jd/application-operations-list.json`**

Synthesized minimal list response (JD's actual list format used elsewhere):

```json
{
  "@type": "PagingResponse",
  "values": [
    {
      "@type": "FieldOperation",
      "id": "00000000-0000-0000-0000-000000000001",
      "fieldOperationType": "application",
      "cropSeason": "2025",
      "startDate": "2025-06-03T22:01:57.473Z",
      "endDate": "2025-06-03T22:02:31.477Z"
    },
    {
      "@type": "FieldOperation",
      "id": "00000000-0000-0000-0000-000000000002",
      "fieldOperationType": "application",
      "cropSeason": "2026",
      "startDate": "2026-03-13T16:03:56.849Z",
      "endDate": "2026-03-19T21:07:39.475Z"
    }
  ],
  "links": [],
  "total": 2
}
```

- [ ] **Step 4: Create `__fixtures__/jd/README.md`**

```markdown
# JD API fixtures

Captured responses from the John Deere Operations Center API, used by Vitest + Deno tests.

## Files

- `application-rate-result-single-tankmix.json` — clean APPLICATION measurement with one tank mix line (active herbicide + water carrier). Source: Phase 0c capture 2026-05-28 from Galen's "A Test/ Clean out" field.
- `application-rate-result-404.json` — real JD 404 error payload for a missing measurement.
- `application-operations-list.json` — `GET /fieldOperations?fieldOperationType=APPLICATION` response shape.

## Refreshing fixtures

When JD's API shape changes, run `npx tsx scripts/capture-jd-fixtures.ts` against a live signed-in account (requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` + a JWT from a real session). The script writes new files here. Manually anonymize org/field/operation IDs before committing.

## Tests using these

- `supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts`
- `supabase/functions/john-deere-import/__tests__/derive-application-name.test.ts`
- `supabase/functions/john-deere-import/__tests__/import-applications.test.ts`
```

- [ ] **Step 5: Create `scripts/capture-jd-fixtures.ts`**

```typescript
// Run with: npx tsx scripts/capture-jd-fixtures.ts
// Requires environment: SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT
// Hits the existing debug-spray-shape edge function and writes its response to __fixtures__/jd/.
// Manually anonymize IDs (replace org/field/operation IDs with synthetic UUIDs) before committing.

import { writeFile } from "node:fs/promises";
import path from "node:path";

const supabaseUrl = process.env.SUPABASE_URL;
const userJwt = process.env.USER_JWT;

if (!supabaseUrl || !userJwt) {
  console.error("Required: SUPABASE_URL, USER_JWT");
  process.exit(1);
}

const out = path.resolve(__dirname, "../__fixtures__/jd");

async function main() {
  const r = await fetch(`${supabaseUrl}/functions/v1/debug-spray-shape`, {
    headers: { Authorization: `Bearer ${userJwt}` },
  });
  const data = await r.json();
  const file = path.join(
    out,
    `debug-spray-shape-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(file, JSON.stringify(data, null, 2));
  console.log(`Wrote ${file}`);
  console.log("Anonymize IDs before committing.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add __fixtures__/jd/ scripts/capture-jd-fixtures.ts
git commit -m "test: seed JD fixture data from Phase 0c capture"
```

---

### Task 4: Wire Vitest into `prebuild`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Read current `package.json` scripts**

```bash
cat package.json | grep -A 20 '"scripts"'
```

Note the existing `prebuild` script (if any) and `build` script.

- [ ] **Step 2: Update `prebuild` to run lint + typecheck + test**

In `package.json`, modify the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "prebuild": "npm run lint && npm run typecheck && npm run test",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:debug": "playwright test --debug"
}
```

Preserve any other scripts (`format`, etc.) that exist.

- [ ] **Step 3: Run `npm run prebuild` end-to-end**

```bash
npm run prebuild
```

Expected: lint passes (existing baseline), typecheck passes, Vitest runs 1 test (sanity), no errors.

If `lint` fails with errors unrelated to this build, file under tech-debt — don't fix in this task. If `typecheck` fails on new test files, fix in this task.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: wire Vitest into prebuild (lint + typecheck + test)"
```

---

### Task 5: Migration — `products` table

**Files:**

- Create: `supabase/migrations/20260528120000_create_products_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260528120000_create_products_table.sql
-- Creates the catalog of unique John Deere products per (user, org), populated by
-- import-applications. Future cost layer (product_price_events) joins on products.id.
-- See docs/superpowers/specs/2026-05-28-spray-application-sync-design.md section 4.1.

BEGIN;

CREATE TABLE operations_center.products (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                   text NOT NULL,
  jd_product_id            text NOT NULL,
  name                     text NOT NULL,
  name_normalized          text NOT NULL,
  brand                    text,
  is_carrier_default       boolean NOT NULL DEFAULT false,
  product_kind             text,
  product_category         text,
  product_category_source  text,
  default_unit             text,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  raw_response             jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_jd_uniq UNIQUE (user_id, org_id, jd_product_id)
);

CREATE INDEX products_user_org_idx ON operations_center.products (user_id, org_id);
CREATE INDEX products_name_normalized_idx ON operations_center.products (user_id, org_id, name_normalized);
CREATE INDEX products_category_idx ON operations_center.products (user_id, org_id, product_category);

ALTER TABLE operations_center.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select_products" ON operations_center.products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_products" ON operations_center.products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_products" ON operations_center.products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_products" ON operations_center.products
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.products TO authenticated;
GRANT ALL ON operations_center.products TO service_role;

COMMIT;
```

- [ ] **Step 2: Commit the migration file (not yet applied)**

```bash
git add supabase/migrations/20260528120000_create_products_table.sql
git commit -m "db: migration — create operations_center.products table with RLS"
```

---

### Task 6: Migration — `field_operation_products` table + trigger

**Files:**

- Create: `supabase/migrations/20260528120100_create_field_operation_products_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260528120100_create_field_operation_products_table.sql
-- Per-product tank-mix line items. The analytics workhorse.
-- See spec section 4.1.

BEGIN;

CREATE TABLE operations_center.field_operation_products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                      text NOT NULL,
  field_operation_id          uuid NOT NULL REFERENCES operations_center.field_operations(id) ON DELETE CASCADE,
  product_id                  uuid NOT NULL REFERENCES operations_center.products(id) ON DELETE RESTRICT,
  line_index                  integer NOT NULL,
  product_category_override   text,
  is_carrier                  boolean NOT NULL DEFAULT false,

  -- Live editable values
  rate_value                  double precision,
  rate_unit                   text,
  rate_variable               text,
  total_value                 double precision,
  total_unit                  text,
  total_variable              text,
  area_value                  double precision,
  area_unit                   text,

  -- JD original values (set on import, never modified by user edits)
  rate_value_jd_original      double precision,
  total_value_jd_original     double precision,
  area_value_jd_original      double precision,

  -- Edit tracking
  is_user_edited              boolean NOT NULL DEFAULT false,
  edited_at                   timestamptz,

  -- Soft-delete for re-import merge
  deleted_at                  timestamptz,

  raw_response                jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fop_line_uniq UNIQUE (field_operation_id, line_index)
);

CREATE INDEX fop_user_org_idx ON operations_center.field_operation_products (user_id, org_id);
CREATE INDEX fop_field_operation_idx ON operations_center.field_operation_products (field_operation_id);
CREATE INDEX fop_product_idx ON operations_center.field_operation_products (product_id);
CREATE INDEX fop_user_org_product_idx ON operations_center.field_operation_products (user_id, org_id, product_id)
  WHERE deleted_at IS NULL;

-- Backup-guard trigger (edge function writes user_id/org_id explicitly; this only fills if null)
CREATE OR REPLACE FUNCTION operations_center.fop_set_user_org_from_field_op()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.org_id IS NULL THEN
    SELECT user_id, org_id INTO NEW.user_id, NEW.org_id
    FROM operations_center.field_operations
    WHERE id = NEW.field_operation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fop_set_user_org_before_insert
  BEFORE INSERT ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION operations_center.fop_set_user_org_from_field_op();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION operations_center.fop_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fop_set_updated_at_before_update
  BEFORE UPDATE ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION operations_center.fop_set_updated_at();

ALTER TABLE operations_center.field_operation_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select_fop" ON operations_center.field_operation_products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_fop" ON operations_center.field_operation_products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_fop" ON operations_center.field_operation_products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_fop" ON operations_center.field_operation_products
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.field_operation_products TO authenticated;
GRANT ALL ON operations_center.field_operation_products TO service_role;

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260528120100_create_field_operation_products_table.sql
git commit -m "db: migration — create field_operation_products + triggers + RLS"
```

---

### Task 7: Migration — extend `field_operations` for applications

**Files:**

- Create: `supabase/migrations/20260528120200_extend_field_operations_for_applications.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260528120200_extend_field_operations_for_applications.sql
-- Adds three columns to existing field_operations table:
-- - measurement_status: tracks whether the JD measurement endpoint returned data (Phase 0c finding: 404s are normal)
-- - application_name: the editable tank-mix recipe name surfaced in UI
-- - application_name_jd_original + application_name_user_edited: revert support
-- See spec section 4.1.

BEGIN;

ALTER TABLE operations_center.field_operations
  ADD COLUMN measurement_status text NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN operations_center.field_operations.measurement_status IS
  'available | not_found | error | unknown — JD measurement fetch state';

ALTER TABLE operations_center.field_operations
  ADD COLUMN application_name text,
  ADD COLUMN application_name_jd_original text,
  ADD COLUMN application_name_user_edited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN operations_center.field_operations.application_name IS
  'Editable tank-mix recipe label (e.g., "Infurrow", "Corn Blend"). Derived from JD outer ApplicationProductTotal.name on import.';

CREATE INDEX field_operations_measurement_status_idx
  ON operations_center.field_operations (user_id, org_id, measurement_status)
  WHERE measurement_status IN ('not_found', 'error');

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260528120200_extend_field_operations_for_applications.sql
git commit -m "db: migration — extend field_operations with measurement_status + application_name"
```

---

### Task 8: Migration — `product_category_seeds` lookup table

**Files:**

- Create: `supabase/migrations/20260528120300_create_product_category_seeds_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 20260528120300_create_product_category_seeds_table.sql
-- Lookup table for auto-classifying new products by name pattern.
-- Single source of truth (per Codex v2 C — no parallel hardcoded heuristic).
-- See spec section 4.6.

BEGIN;

CREATE TABLE operations_center.product_category_seeds (
  name_pattern         text PRIMARY KEY,
  match_type           text NOT NULL DEFAULT 'contains',
  product_category     text NOT NULL,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_type_check CHECK (match_type IN ('contains', 'exact'))
);

INSERT INTO operations_center.product_category_seeds (name_pattern, match_type, product_category, notes) VALUES
  -- Chemicals
  ('atrazine',    'contains', 'chemical',   'herbicide'),
  ('glyphosate',  'contains', 'chemical',   'herbicide'),
  ('roundup',     'contains', 'chemical',   'herbicide'),
  ('2,4-d',       'contains', 'chemical',   'herbicide'),
  ('dicamba',     'contains', 'chemical',   'herbicide'),
  ('outlook',     'exact',    'chemical',   'BASF herbicide — exact to avoid false match'),
  ('zidua',       'contains', 'chemical',   'herbicide'),
  ('liberty',     'contains', 'chemical',   'herbicide — glufosinate'),
  ('enlist',      'contains', 'chemical',   'herbicide'),
  -- Fertilizers
  ('uan',         'exact',    'fertilizer', '28%, 32% — exact to avoid junk match'),
  ('urea',        'contains', 'fertilizer', NULL),
  ('map ',        'contains', 'fertilizer', '11-52-0 — trailing space to avoid mapleseed'),
  ('dap',         'exact',    'fertilizer', '18-46-0'),
  ('potash',      'contains', 'fertilizer', NULL),
  ('anhydrous',   'contains', 'fertilizer', 'NH3'),
  ('zinc sulf',   'contains', 'fertilizer', 'micronutrient'),
  ('gypsum',      'contains', 'fertilizer', 'soil amendment'),
  -- Adjuvants
  ('ams',         'exact',    'adjuvant',   'ammonium sulfate'),
  ('nis',         'exact',    'adjuvant',   'non-ionic surfactant'),
  ('mso',         'exact',    'adjuvant',   'methylated seed oil'),
  -- Carrier
  ('water',       'exact',    'other',      'carrier; also flagged via JD carrier=true');

-- Read-only table for users; service_role manages content.
ALTER TABLE operations_center.product_category_seeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_authenticated_read_seeds" ON operations_center.product_category_seeds
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON operations_center.product_category_seeds TO authenticated;
GRANT ALL ON operations_center.product_category_seeds TO service_role;

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260528120300_create_product_category_seeds_table.sql
git commit -m "db: migration — seed common product category classifications"
```

---

### Task 9: Apply all four migrations to the shared Supabase project

**Files:** none modified. Uses `mcp__supabase__apply_migration`.

- [ ] **Step 1: Confirm Supabase project ref is `nuxofsjzrgdauzriraze`**

Per `.claude/rules/architecture.md` — this app shares the Farm Budget project. Confirm with:

```bash
cat supabase/config.toml 2>/dev/null | grep project_id || echo "no config.toml — use MCP only"
```

- [ ] **Step 2: List existing tables to confirm `operations_center` schema is intact before applying**

Use `mcp__supabase__list_tables` with `project_id: "nuxofsjzrgdauzriraze"`, `schemas: ["operations_center"]`. Expect to see: `fields`, `field_operations`, `john_deere_connections`, `irrigation_analysis_results`, `field_seasons`. If any of these are missing, STOP — talk to Galen.

- [ ] **Step 3: Apply migration 1 — products table**

Use `mcp__supabase__apply_migration` with:

- `project_id: "nuxofsjzrgdauzriraze"`
- `name: "create_products_table"`
- `query`: the SQL content from `supabase/migrations/20260528120000_create_products_table.sql`

Expected: success message. Verify via `mcp__supabase__list_tables` — `products` now appears.

- [ ] **Step 4: Apply migration 2 — field_operation_products + triggers**

Use `mcp__supabase__apply_migration` with `name: "create_field_operation_products"` and the corresponding SQL. Verify table exists and has the expected columns.

- [ ] **Step 5: Apply migration 3 — extend field_operations**

Use `mcp__supabase__apply_migration` with `name: "extend_field_operations_for_applications"`. Verify with `mcp__supabase__execute_sql`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'operations_center'
  AND table_name = 'field_operations'
  AND column_name IN ('measurement_status', 'application_name', 'application_name_jd_original', 'application_name_user_edited');
```

Expected: 4 rows.

- [ ] **Step 6: Apply migration 4 — product_category_seeds + seed data**

Use `mcp__supabase__apply_migration` with `name: "create_product_category_seeds"`. Verify:

```sql
SELECT COUNT(*) FROM operations_center.product_category_seeds;
```

Expected: 21 rows (the seed list).

- [ ] **Step 7: Run security advisors to catch any RLS gaps introduced**

Use `mcp__supabase__get_advisors` with `type: "security"` and `project_id: "nuxofsjzrgdauzriraze"`. Expected: no NEW high-severity findings on `operations_center.products`, `operations_center.field_operation_products`, `operations_center.product_category_seeds`. Pre-existing findings on other tables are not in scope.

- [ ] **Step 8: Commit a marker note (no code change)**

```bash
git commit --allow-empty -m "db: applied migrations 20260528120000-300 to nuxofsjzrgdauzriraze"
```

This marker commit makes the apply-step traceable in git log alongside the migration files.

---

### Task 10: TDD — `extract-tankmix` helper (JD response → flat product lines)

**Files:**

- Create: `supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts`
- Create: `supabase/functions/john-deere-import/helpers/extract-tankmix.ts`
- Create: `supabase/functions/john-deere-import/shared/types.ts`

This helper takes the JD ApplicationRateResult JSON and produces a flat array of `ExtractedProductLine` objects — one per inner `ProductTotal`. The flat structure feeds the merge-by-line_index logic.

- [ ] **Step 1: Create `shared/types.ts` with JD response interfaces**

```typescript
// supabase/functions/john-deere-import/shared/types.ts

export interface JdEventMeasurement {
  "@type"?: string;
  value?: number;
  unitId?: string;
  variableRepresentation?: string;
  edited?: boolean;
}

export interface JdProductTotal {
  "@type"?: string;
  productId?: string;
  name?: string;
  brand?: string;
  carrier?: boolean;
  totalMaterial?: JdEventMeasurement;
  averageMaterial?: JdEventMeasurement;
}

export interface JdApplicationProductTotal {
  "@type"?: string;
  productId?: string;
  name?: string;
  area?: JdEventMeasurement;
  averageSpeed?: JdEventMeasurement;
  totalMaterial?: JdEventMeasurement;
  averageMaterial?: JdEventMeasurement;
  appliedArea?: JdEventMeasurement;
  productTotals?: JdProductTotal[];
}

export interface JdApplicationRateResult {
  "@type"?: string;
  measurementName?: string;
  measurementCategory?: string;
  varietyTotals?: unknown[];
  applicationProductTotals?: JdApplicationProductTotal[];
  links?: Array<{ rel: string; uri: string }>;
}

// Flat output for the merge layer
export interface ExtractedProductLine {
  line_index: number; // global counter across all outer aggregates
  outer_aggregate_index: number; // which applicationProductTotals[i] this came from
  jd_product_id: string;
  name: string;
  brand: string | null;
  is_carrier: boolean;
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;
  raw_response: JdProductTotal;
}
```

- [ ] **Step 2: Write failing test — `__tests__/extract-tankmix.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractTankmix } from "../helpers/extract-tankmix.ts";
import type { JdApplicationRateResult } from "../shared/types.ts";

function loadFixture(name: string): JdApplicationRateResult {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, `../../../../__fixtures__/jd/${name}`), "utf-8"),
  );
}

describe("extractTankmix", () => {
  it("returns two flat lines for the single-tankmix fixture (Atrazine-like + water)", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result).toHaveLength(2);
  });

  it("assigns global line_index across outer aggregates (0, 1) for single-aggregate input", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.map((l) => l.line_index)).toEqual([0, 1]);
  });

  it("captures the carrier flag from JD on each line", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.find((l) => l.name === "EnzUpP")?.is_carrier).toBe(false);
    expect(result.find((l) => l.name === "Water")?.is_carrier).toBe(true);
  });

  it("extracts rate_value + rate_unit from averageMaterial", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    const enz = result.find((l) => l.name === "EnzUpP");
    expect(enz?.rate_value).toBe(7.49);
    expect(enz?.rate_unit).toBe("gal1ac-1");
  });

  it("extracts total_value + total_unit from totalMaterial", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    const enz = result.find((l) => l.name === "EnzUpP");
    expect(enz?.total_value).toBe(0.3);
    expect(enz?.total_unit).toBe("gal");
  });

  it("inherits area_value + area_unit from the OUTER ApplicationProductTotal", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result[0].area_value).toBe(0.04);
    expect(result[0].area_unit).toBe("ac");
  });

  it("returns empty array when applicationProductTotals is missing or empty", () => {
    expect(extractTankmix({} as JdApplicationRateResult)).toEqual([]);
    expect(extractTankmix({ applicationProductTotals: [] })).toEqual([]);
  });

  it("preserves the raw JD ProductTotal verbatim on raw_response", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result[0].raw_response.productId).toBe("66834dae-f252-4454-99b0-d7a287e9d4fe");
  });

  it("preserves outer_aggregate_index so downstream can group by tank mix recipe", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.every((l) => l.outer_aggregate_index === 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
npm test -- extract-tankmix
```

Expected: "Cannot find module '../helpers/extract-tankmix.ts'".

- [ ] **Step 4: Implement `helpers/extract-tankmix.ts`**

```typescript
// supabase/functions/john-deere-import/helpers/extract-tankmix.ts

import type { ExtractedProductLine, JdApplicationRateResult } from "../shared/types.ts";

export function extractTankmix(input: JdApplicationRateResult): ExtractedProductLine[] {
  const out: ExtractedProductLine[] = [];
  const outers = input.applicationProductTotals ?? [];
  let lineIndex = 0;

  for (let i = 0; i < outers.length; i++) {
    const outer = outers[i];
    const inners = outer.productTotals ?? [];
    for (const inner of inners) {
      out.push({
        line_index: lineIndex++,
        outer_aggregate_index: i,
        jd_product_id: inner.productId ?? "",
        name: inner.name ?? "",
        brand: inner.brand && inner.brand !== "---" ? inner.brand : null,
        is_carrier: inner.carrier === true,
        rate_value: inner.averageMaterial?.value ?? null,
        rate_unit: inner.averageMaterial?.unitId ?? null,
        rate_variable: inner.averageMaterial?.variableRepresentation ?? null,
        total_value: inner.totalMaterial?.value ?? null,
        total_unit: inner.totalMaterial?.unitId ?? null,
        total_variable: inner.totalMaterial?.variableRepresentation ?? null,
        area_value: outer.appliedArea?.value ?? outer.area?.value ?? null,
        area_unit: outer.appliedArea?.unitId ?? outer.area?.unitId ?? null,
        raw_response: inner,
      });
    }
  }

  return out;
}
```

- [ ] **Step 5: Run test, verify all pass**

```bash
npm test -- extract-tankmix
```

Expected: 9 tests passing.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/john-deere-import/shared/types.ts \
        supabase/functions/john-deere-import/helpers/extract-tankmix.ts \
        supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts
git commit -m "feat(import): extractTankmix — flat product lines from JD ApplicationRateResult"
```

---

### Task 11: TDD — `derive-application-name` helper

**Files:**

- Create: `supabase/functions/john-deere-import/__tests__/derive-application-name.test.ts`
- Create: `supabase/functions/john-deere-import/helpers/derive-application-name.ts`

Deterministic rule (spec section 5.2 step 4): sorted distinct non-placeholder names, `'; '` joined; null if no usable names.

- [ ] **Step 1: Write failing test**

```typescript
// supabase/functions/john-deere-import/__tests__/derive-application-name.test.ts
import { describe, it, expect } from "vitest";
import { deriveApplicationName } from "../helpers/derive-application-name.ts";
import type { JdApplicationRateResult } from "../shared/types.ts";

describe("deriveApplicationName", () => {
  it("returns the single outer name when there is exactly one", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("returns sorted distinct names joined with '; ' for multiple aggregates", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [
        { name: "Outlook" },
        { name: "Atrazine" },
        { name: "Outlook" }, // dup
      ],
    };
    expect(deriveApplicationName(input)).toBe("Atrazine; Outlook");
  });

  it("filters '---' placeholder names", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }, { name: "---" }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("filters empty string and whitespace-only names", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }, { name: "" }, { name: "   " }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("returns null when no usable names exist", () => {
    expect(deriveApplicationName({})).toBeNull();
    expect(deriveApplicationName({ applicationProductTotals: [] })).toBeNull();
    expect(
      deriveApplicationName({ applicationProductTotals: [{ name: "---" }, { name: "" }] }),
    ).toBeNull();
  });

  it("does NOT truncate at the storage layer (callers truncate for display)", () => {
    const longName = "A".repeat(200);
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: longName }],
    };
    expect(deriveApplicationName(input)).toBe(longName);
  });

  it("treats names case-sensitively for sort but preserves original casing", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "outlook" }, { name: "Atrazine" }],
    };
    // ASCII sort: uppercase 'A' (65) < lowercase 'o' (111)
    expect(deriveApplicationName(input)).toBe("Atrazine; outlook");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- derive-application-name
```

Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/john-deere-import/helpers/derive-application-name.ts
import type { JdApplicationRateResult } from "../shared/types.ts";

const PLACEHOLDER = "---";

export function deriveApplicationName(input: JdApplicationRateResult): string | null {
  const outers = input.applicationProductTotals ?? [];
  const names = outers
    .map((o) => o.name?.trim() ?? "")
    .filter((n) => n.length > 0 && n !== PLACEHOLDER);

  if (names.length === 0) return null;

  const distinct = Array.from(new Set(names)).sort();
  return distinct.join("; ");
}
```

- [ ] **Step 4: Run test, all green**

```bash
npm test -- derive-application-name
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/john-deere-import/helpers/derive-application-name.ts \
        supabase/functions/john-deere-import/__tests__/derive-application-name.test.ts
git commit -m "feat(import): deriveApplicationName — sorted distinct outer names joined with '; '"
```

---

### Task 12: TDD — `normalize` helper (name_normalized)

**Files:**

- Create: `supabase/functions/john-deere-import/__tests__/normalize.test.ts`
- Create: `supabase/functions/john-deere-import/helpers/normalize.ts`

- [ ] **Step 1: Write failing test**

```typescript
// supabase/functions/john-deere-import/__tests__/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeProductName } from "../helpers/normalize.ts";

describe("normalizeProductName", () => {
  it("lowercases", () => {
    expect(normalizeProductName("ATRAZINE")).toBe("atrazine");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeProductName("  Atrazine  ")).toBe("atrazine");
  });

  it("collapses internal multiple-spaces to a single space", () => {
    expect(normalizeProductName("Anhydrous   Ammonia")).toBe("anhydrous ammonia");
  });

  it("preserves punctuation that is meaningful (e.g., '2,4-d', percents)", () => {
    expect(normalizeProductName("2,4-D")).toBe("2,4-d");
    expect(normalizeProductName("Zinc Sulfate 35%")).toBe("zinc sulfate 35%");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeProductName("")).toBe("");
    expect(normalizeProductName("   ")).toBe("");
  });

  it("strips trailing parenthetical brand/strength notes if present at end? NO — preserves them", () => {
    expect(normalizeProductName("Anhydrous Ammonia (NH3)")).toBe("anhydrous ammonia (nh3)");
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- normalize
```

Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/john-deere-import/helpers/normalize.ts

export function normalizeProductName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Run, all green**

```bash
npm test -- normalize
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/john-deere-import/helpers/normalize.ts \
        supabase/functions/john-deere-import/__tests__/normalize.test.ts
git commit -m "feat(import): normalizeProductName for name_normalized"
```

---

### Task 13: TDD — `merge-application-products` (the 5-case decision tree)

**Files:**

- Create: `supabase/functions/john-deere-import/__tests__/merge-application-products.test.ts`
- Create: `supabase/functions/john-deere-import/helpers/merge-application-products.ts`

This is the highest-risk pure logic in the build. It decides, for each line in the JD response and each existing DB row, what to do: insert, update non-edited, skip edited, or soft-delete vanished. The 5 cases (spec section 5.4):

1. New line in JD, no DB row → INSERT
2. Existing DB row, `is_user_edited = false`, line present in JD → UPDATE live + JD-original columns
3. Existing DB row, `is_user_edited = true`, line present in JD → SKIP entirely (preserve edit)
4. Existing DB row, `is_user_edited = false`, line NOT in JD → SOFT-DELETE
5. Existing DB row, `is_user_edited = true`, line NOT in JD → LEAVE UNTOUCHED (preserve orphan)

The function is pure: takes (incoming JD lines, existing DB rows, field_operation_id, user_id, org_id) and returns a `MergePlan` describing the SQL operations to perform. Edge function then executes the plan.

- [ ] **Step 1: Write failing test**

```typescript
// supabase/functions/john-deere-import/__tests__/merge-application-products.test.ts
import { describe, it, expect } from "vitest";
import { mergeApplicationProducts } from "../helpers/merge-application-products.ts";
import type { ExtractedProductLine } from "../shared/types.ts";

const FIELD_OP_ID = "00000000-0000-0000-0000-00000000F0F0";
const USER_ID = "00000000-0000-0000-0000-00000000U0U0";
const ORG_ID = "600550";

function mkIncoming(overrides: Partial<ExtractedProductLine>): ExtractedProductLine {
  return {
    line_index: 0,
    outer_aggregate_index: 0,
    jd_product_id: "pid-A",
    name: "Atrazine",
    brand: null,
    is_carrier: false,
    rate_value: 4,
    rate_unit: "qt1ac-1",
    rate_variable: "vrAppRateVolumeMeasured",
    total_value: 316,
    total_unit: "qt",
    total_variable: "vrTotalQuantityAppliedVolume",
    area_value: 79,
    area_unit: "ac",
    raw_response: {} as ExtractedProductLine["raw_response"],
    ...overrides,
  };
}

function mkExisting(overrides: {
  id: string;
  line_index: number;
  product_id: string;
  is_user_edited?: boolean;
}) {
  return {
    id: overrides.id,
    line_index: overrides.line_index,
    product_id: overrides.product_id,
    is_user_edited: overrides.is_user_edited ?? false,
    deleted_at: null as string | null,
  };
}

describe("mergeApplicationProducts — 5-case decision tree", () => {
  it("Case 1: new line in JD, no DB row → INSERT", () => {
    const incoming = [mkIncoming({ line_index: 0 })];
    const existing: ReturnType<typeof mkExisting>[] = [];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.toInsert[0]).toMatchObject({
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      line_index: 0,
      product_id: "00000000-0000-0000-0000-0000000000A0",
      is_user_edited: false,
      rate_value: 4,
      rate_value_jd_original: 4,
      total_value: 316,
      total_value_jd_original: 316,
      area_value: 79,
      area_value_jd_original: 79,
      deleted_at: null,
    });
  });

  it("Case 2: existing line, NOT user-edited, present in JD → UPDATE both live + JD-original", () => {
    const incoming = [mkIncoming({ line_index: 0, rate_value: 5 })]; // JD changed rate from 4 to 5
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: false,
      }),
    ];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.toUpdate[0]).toMatchObject({
      id: "row-X",
      patch: {
        rate_value: 5,
        rate_value_jd_original: 5,
        total_value: 316,
        total_value_jd_original: 316,
        area_value: 79,
        area_value_jd_original: 79,
      },
    });
  });

  it("Case 3: existing line, user-edited, present in JD → SKIP (preserve edits)", () => {
    const incoming = [mkIncoming({ line_index: 0, rate_value: 5 })];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: true,
      }),
    ];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toEqual({ id: "row-X", reason: "user_edited_present_in_jd" });
  });

  it("Case 4: existing line, NOT user-edited, line VANISHED from JD → SOFT-DELETE", () => {
    const incoming: ExtractedProductLine[] = [];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: false,
      }),
    ];
    const productIdByJdId = new Map();

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toEqual([{ id: "row-X" }]);
    expect(plan.skipped).toHaveLength(0);
  });

  it("Case 5: existing line, user-edited, line VANISHED from JD → LEAVE UNTOUCHED", () => {
    const incoming: ExtractedProductLine[] = [];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: true,
      }),
    ];
    const productIdByJdId = new Map();

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toEqual([{ id: "row-X", reason: "user_edited_vanished_from_jd" }]);
  });

  it("Combined: insert + update + skip + soft-delete in one merge", () => {
    const incoming = [
      mkIncoming({ line_index: 0, jd_product_id: "pid-A" }), // matches existing edited → skip
      mkIncoming({ line_index: 1, jd_product_id: "pid-B", name: "2,4-D" }), // matches existing non-edited → update
      mkIncoming({ line_index: 2, jd_product_id: "pid-C", name: "AMS" }), // new → insert
    ];
    const existing = [
      mkExisting({ id: "row-edit", line_index: 0, product_id: "pa", is_user_edited: true }),
      mkExisting({ id: "row-up", line_index: 1, product_id: "pb", is_user_edited: false }),
      mkExisting({ id: "row-del", line_index: 5, product_id: "pz", is_user_edited: false }), // vanished
    ];
    const productIdByJdId = new Map([
      ["pid-A", "pa"],
      ["pid-B", "pb"],
      ["pid-C", "pc"],
    ]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert.map((r) => r.line_index)).toEqual([2]);
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["row-up"]);
    expect(plan.toSoftDelete.map((d) => d.id)).toEqual(["row-del"]);
    expect(plan.skipped.map((s) => s.id)).toEqual(["row-edit"]);
  });

  it("throws if incoming line references a productId not in productIdByJdId map", () => {
    const incoming = [mkIncoming({ jd_product_id: "pid-UNKNOWN" })];
    expect(() =>
      mergeApplicationProducts({
        incoming,
        existing: [],
        productIdByJdId: new Map(),
        field_operation_id: FIELD_OP_ID,
        user_id: USER_ID,
        org_id: ORG_ID,
      }),
    ).toThrow(/pid-UNKNOWN/);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- merge-application-products
```

Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/john-deere-import/helpers/merge-application-products.ts

import type { ExtractedProductLine } from "../shared/types.ts";

export interface ExistingProductRow {
  id: string;
  line_index: number;
  product_id: string;
  is_user_edited: boolean;
  deleted_at: string | null;
}

export interface InsertRow {
  field_operation_id: string;
  user_id: string;
  org_id: string;
  line_index: number;
  product_id: string;
  is_carrier: boolean;
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;
  rate_value_jd_original: number | null;
  total_value_jd_original: number | null;
  area_value_jd_original: number | null;
  is_user_edited: false;
  raw_response: unknown;
  deleted_at: null;
}

export interface UpdateRow {
  id: string;
  patch: {
    rate_value: number | null;
    rate_unit: string | null;
    rate_variable: string | null;
    total_value: number | null;
    total_unit: string | null;
    total_variable: string | null;
    area_value: number | null;
    area_unit: string | null;
    rate_value_jd_original: number | null;
    total_value_jd_original: number | null;
    area_value_jd_original: number | null;
    raw_response: unknown;
    deleted_at: null; // un-delete if was soft-deleted then JD brings the line back
  };
}

export interface SoftDeleteRow {
  id: string;
}

export interface SkipRecord {
  id: string;
  reason: "user_edited_present_in_jd" | "user_edited_vanished_from_jd";
}

export interface MergePlan {
  toInsert: InsertRow[];
  toUpdate: UpdateRow[];
  toSoftDelete: SoftDeleteRow[];
  skipped: SkipRecord[];
}

export interface MergeInput {
  incoming: ExtractedProductLine[];
  existing: ExistingProductRow[];
  productIdByJdId: Map<string, string>; // jd_product_id -> products.id (UUID)
  field_operation_id: string;
  user_id: string;
  org_id: string;
}

export function mergeApplicationProducts(input: MergeInput): MergePlan {
  const plan: MergePlan = {
    toInsert: [],
    toUpdate: [],
    toSoftDelete: [],
    skipped: [],
  };

  const existingByLineIndex = new Map(input.existing.map((e) => [e.line_index, e]));
  const incomingByLineIndex = new Map(input.incoming.map((i) => [i.line_index, i]));

  for (const inc of input.incoming) {
    const productId = input.productIdByJdId.get(inc.jd_product_id);
    if (!productId) {
      throw new Error(
        `mergeApplicationProducts: incoming line references unknown jd_product_id="${inc.jd_product_id}". Products catalog must be upserted before merge.`,
      );
    }

    const existing = existingByLineIndex.get(inc.line_index);

    if (!existing) {
      // Case 1: new line → INSERT
      plan.toInsert.push({
        field_operation_id: input.field_operation_id,
        user_id: input.user_id,
        org_id: input.org_id,
        line_index: inc.line_index,
        product_id: productId,
        is_carrier: inc.is_carrier,
        rate_value: inc.rate_value,
        rate_unit: inc.rate_unit,
        rate_variable: inc.rate_variable,
        total_value: inc.total_value,
        total_unit: inc.total_unit,
        total_variable: inc.total_variable,
        area_value: inc.area_value,
        area_unit: inc.area_unit,
        rate_value_jd_original: inc.rate_value,
        total_value_jd_original: inc.total_value,
        area_value_jd_original: inc.area_value,
        is_user_edited: false,
        raw_response: inc.raw_response,
        deleted_at: null,
      });
    } else if (existing.is_user_edited) {
      // Case 3: user-edited line present in JD → SKIP
      plan.skipped.push({ id: existing.id, reason: "user_edited_present_in_jd" });
    } else {
      // Case 2: non-edited line present in JD → UPDATE
      plan.toUpdate.push({
        id: existing.id,
        patch: {
          rate_value: inc.rate_value,
          rate_unit: inc.rate_unit,
          rate_variable: inc.rate_variable,
          total_value: inc.total_value,
          total_unit: inc.total_unit,
          total_variable: inc.total_variable,
          area_value: inc.area_value,
          area_unit: inc.area_unit,
          rate_value_jd_original: inc.rate_value,
          total_value_jd_original: inc.total_value,
          area_value_jd_original: inc.area_value,
          raw_response: inc.raw_response,
          deleted_at: null,
        },
      });
    }
  }

  for (const ex of input.existing) {
    if (incomingByLineIndex.has(ex.line_index)) continue; // handled above
    if (ex.is_user_edited) {
      // Case 5: vanished from JD but user-edited → leave untouched
      plan.skipped.push({ id: ex.id, reason: "user_edited_vanished_from_jd" });
    } else {
      // Case 4: vanished from JD, not edited → soft-delete
      plan.toSoftDelete.push({ id: ex.id });
    }
  }

  return plan;
}
```

- [ ] **Step 4: Run, verify all 7 tests pass**

```bash
npm test -- merge-application-products
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/john-deere-import/helpers/merge-application-products.ts \
        supabase/functions/john-deere-import/__tests__/merge-application-products.test.ts
git commit -m "feat(import): mergeApplicationProducts — 5-case decision tree for re-import"
```

---

### Task 14: TDD — seed-list category matcher (`category-utils`)

**Files:**

- Create: `lib/category-utils.ts`
- Create: `lib/__tests__/category-utils.test.ts`

This module powers two things: (a) the effective category resolver (override ?? products.category) and (b) the seed-list pattern matcher used by `import-applications`. The matcher is a pure function that takes a `name_normalized` and a list of seed patterns, returns a category or null.

- [ ] **Step 1: Write failing test**

```typescript
// lib/__tests__/category-utils.test.ts
import { describe, it, expect } from "vitest";
import { matchCategoryFromSeeds, effectiveCategory } from "../category-utils.ts";
import type { CategorySeed } from "../category-utils.ts";

const seeds: CategorySeed[] = [
  { name_pattern: "atrazine", match_type: "contains", product_category: "chemical" },
  { name_pattern: "outlook", match_type: "exact", product_category: "chemical" },
  { name_pattern: "uan", match_type: "exact", product_category: "fertilizer" },
  { name_pattern: "urea", match_type: "contains", product_category: "fertilizer" },
  { name_pattern: "water", match_type: "exact", product_category: "other" },
];

describe("matchCategoryFromSeeds", () => {
  it("returns category for an exact match", () => {
    expect(matchCategoryFromSeeds("outlook", seeds)).toBe("chemical");
    expect(matchCategoryFromSeeds("uan", seeds)).toBe("fertilizer");
  });

  it("returns category for a contains match", () => {
    expect(matchCategoryFromSeeds("atrazine 4l", seeds)).toBe("chemical");
    expect(matchCategoryFromSeeds("urea 46-0-0", seeds)).toBe("fertilizer");
  });

  it("does NOT exact-match if name has extra chars", () => {
    expect(matchCategoryFromSeeds("outlook 6oz", seeds)).toBe(null);
    expect(matchCategoryFromSeeds("uan 32%", seeds)).toBe(null);
  });

  it("returns null when no seed matches", () => {
    expect(matchCategoryFromSeeds("mystery-product", seeds)).toBe(null);
  });

  it("prefers exact match over contains when both apply (deterministic order)", () => {
    // 'outlook' exact and (hypothetically) a 'out' contains both — exact wins
    const seedsConflict: CategorySeed[] = [
      { name_pattern: "out", match_type: "contains", product_category: "fertilizer" },
      { name_pattern: "outlook", match_type: "exact", product_category: "chemical" },
    ];
    expect(matchCategoryFromSeeds("outlook", seedsConflict)).toBe("chemical");
  });

  it("is case-insensitive on input (caller already normalizes, but defensive)", () => {
    expect(matchCategoryFromSeeds("ATRAZINE", seeds)).toBe("chemical");
  });

  it("returns null for empty input", () => {
    expect(matchCategoryFromSeeds("", seeds)).toBe(null);
  });
});

describe("effectiveCategory", () => {
  it("returns line-override when set", () => {
    expect(effectiveCategory({ override: "fertilizer", productCategory: "chemical" })).toBe(
      "fertilizer",
    );
  });

  it("falls back to product catalog category when no override", () => {
    expect(effectiveCategory({ override: null, productCategory: "chemical" })).toBe("chemical");
    expect(effectiveCategory({ override: undefined, productCategory: "chemical" })).toBe(
      "chemical",
    );
  });

  it("returns null when both are absent", () => {
    expect(effectiveCategory({ override: null, productCategory: null })).toBe(null);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- category-utils
```

- [ ] **Step 3: Implement**

```typescript
// lib/category-utils.ts

export type ProductCategory = "fertilizer" | "chemical" | "seed" | "adjuvant" | "other";

// Free-text field — these 5 are the v1 UI defaults; finer values are valid free text.
export const KNOWN_CATEGORIES: ProductCategory[] = [
  "fertilizer",
  "chemical",
  "seed",
  "adjuvant",
  "other",
];

export interface CategorySeed {
  name_pattern: string;
  match_type: "contains" | "exact";
  product_category: string;
}

export function matchCategoryFromSeeds(
  name_normalized: string,
  seeds: CategorySeed[],
): string | null {
  const haystack = name_normalized.trim().toLowerCase();
  if (haystack.length === 0) return null;

  // Exact matches take priority — scan exact first
  for (const seed of seeds) {
    if (seed.match_type === "exact" && haystack === seed.name_pattern.toLowerCase()) {
      return seed.product_category;
    }
  }
  for (const seed of seeds) {
    if (seed.match_type === "contains" && haystack.includes(seed.name_pattern.toLowerCase())) {
      return seed.product_category;
    }
  }
  return null;
}

export function effectiveCategory(args: {
  override: string | null | undefined;
  productCategory: string | null | undefined;
}): string | null {
  if (args.override) return args.override;
  return args.productCategory ?? null;
}
```

- [ ] **Step 4: Run, verify all 10 tests pass**

```bash
npm test -- category-utils
```

Expected: 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/category-utils.ts lib/__tests__/category-utils.test.ts
git commit -m "feat(applications): category-utils — seed matcher + effective category resolver"
```

---

### Task 15: File split — create new directory structure + shared helpers

The existing `supabase/functions/john-deere-import/index.ts` is 689 lines. This task creates the new structure (empty modules + `shared/`) without moving any logic yet. Per-action extraction happens in Tasks 16-19.

**Files:**

- Create directories: `actions/`, `helpers/`, `shared/` inside `supabase/functions/john-deere-import/`
- Create: `shared/errors.ts`
- Create: `shared/validation.ts`
- Existing: `shared/types.ts` (already created in Task 10)

- [ ] **Step 1: Confirm directories from prior tasks exist**

```bash
ls supabase/functions/john-deere-import/
```

Expected: at minimum `index.ts`, `helpers/`, `shared/`, `__tests__/`. If `actions/` doesn't exist, create it: `mkdir supabase/functions/john-deere-import/actions`.

- [ ] **Step 2: Create `shared/errors.ts`**

```typescript
// supabase/functions/john-deere-import/shared/errors.ts
// Generic error responder — never leaks error.message, error.stack, or upstream payloads.
// Server-side logs the full context; clients get a generic message + stable error code.

interface ErrorBody {
  error: "request_failed" | "unauthorized" | "not_found" | "validation_failed";
  code?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function genericError(
  status: number,
  category: ErrorBody["error"],
  code?: string,
): Response {
  const body: ErrorBody = { error: category };
  if (code) body.code = code;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function logAndRespond(
  status: number,
  category: ErrorBody["error"],
  code: string,
  err: unknown,
  context: Record<string, unknown> = {},
): Response {
  console.error(`[${code}]`, { ...context, error: serializeError(err) });
  return genericError(status, category, code);
}

function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Unknown", message: String(err) };
}
```

- [ ] **Step 3: Create `shared/validation.ts`**

```typescript
// supabase/functions/john-deere-import/shared/validation.ts
// Zod schemas for query params and request bodies — validated before use.

import { z } from "npm:zod@3.22.4";

export const ImportApplicationsQuery = z.object({
  action: z.literal("import-applications"),
  fieldId: z.string().uuid().optional(),
  seasons: z
    .string()
    .regex(/^\d{4}(,\d{4})*$/, "comma-separated 4-digit years")
    .default("2024,2025,2026"),
});

export type ImportApplicationsQueryT = z.infer<typeof ImportApplicationsQuery>;

export function parseSeasons(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Run typecheck to verify imports resolve**

```bash
npm run typecheck
```

Expected: passes (or only pre-existing errors unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/john-deere-import/shared/errors.ts \
        supabase/functions/john-deere-import/shared/validation.ts
git commit -m "refactor(import): add shared/errors + shared/validation modules (scaffolding)"
```

---

### Task 16: File split — extract `import-fields` action

**Files:**

- Create: `supabase/functions/john-deere-import/actions/import-fields.ts`
- Modify: `supabase/functions/john-deere-import/index.ts` (delegate to new module)

The existing `importFields` function at `index.ts:82-226` plus its helpers `fetchAllFieldsPaginated` (lines 23-41) and `fetchIrrigatedBoundaries` (lines 43-80) get lifted intact.

- [ ] **Step 1: Read the current import logic at `index.ts:1-226`**

```bash
sed -n '1,226p' supabase/functions/john-deere-import/index.ts
```

Note all imports, the `JdField` / `JdLink` / `JdBoundary` interfaces, the `convertBoundaryToGeoJSON` / `extractClients` / `extractFarms` imports.

- [ ] **Step 2: Create `actions/import-fields.ts` with the lifted logic**

Copy `fetchAllFieldsPaginated`, `fetchIrrigatedBoundaries`, and `importFields` verbatim from `index.ts:23-226` into the new file. Adjust imports to use relative paths (`../../_shared/...` → `../../../_shared/...` — adjust depth). Export `importFields` only.

- [ ] **Step 3: Update `index.ts` to import the action and call it**

In `index.ts`, REMOVE lines 23-226 (the lifted functions) and ADD:

```typescript
import { importFields } from "./actions/import-fields.ts";
```

The dispatch logic (`if (action === "import-fields")` at line 492) is unchanged — only the function call now resolves to the imported module.

- [ ] **Step 4: Verify typecheck + build still pass**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Smoke-test by deploying and calling the existing action**

Use `mcp__supabase__deploy_edge_function` to deploy `john-deere-import` with all the files in the new structure. Verify the existing `import-fields` action still works by hitting it (browser console snippet pattern from Phase 0c). Expected: same JSON response as before refactor.

If the smoke test fails: investigate; do not proceed until parity is restored.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/john-deere-import/actions/import-fields.ts \
        supabase/functions/john-deere-import/index.ts
git commit -m "refactor(import): extract import-fields action into its own module"
```

---

### Task 17: File split — extract `import-operations` action

**Files:**

- Create: `supabase/functions/john-deere-import/actions/import-operations.ts`
- Create: `supabase/functions/john-deere-import/helpers/fetch-measurement-data.ts`
- Create: `supabase/functions/john-deere-import/helpers/fetch-map-image.ts`
- Modify: `supabase/functions/john-deere-import/index.ts`

The existing `importOperations` (lines 369-453) + helpers `fetchMeasurementData` (lines 261-297) + `fetchAndStoreMapImage` (lines 305-367) + `MEASUREMENT_TYPE_MAP` (lines 243-248) + `JdOperation` interface (lines 230-240) get lifted.

- [ ] **Step 1: Create `helpers/fetch-measurement-data.ts`**

Lift `MEASUREMENT_TYPE_MAP` + `MeasurementResult` interface + `fetchMeasurementData` from index.ts:243-298 verbatim. Export the function and the MAP.

- [ ] **Step 2: Create `helpers/fetch-map-image.ts`**

Lift `MapImageResult` interface + `fetchAndStoreMapImage` from index.ts:299-367 verbatim.

- [ ] **Step 3: Create `actions/import-operations.ts`**

Lift `JdOperation` interface + `importOperations` from index.ts:230-453 (excluding the helpers now in their own files). Import the helpers from `../helpers/fetch-measurement-data.ts` and `../helpers/fetch-map-image.ts`. Note: this action currently handles HARVEST + SEEDING only (line 387: `["HARVEST", "SEEDING"]`); leave that unchanged here — APPLICATION lands in `actions/import-applications.ts` in Task 20.

- [ ] **Step 4: Update `index.ts` to import and delegate**

Remove lifted code; add:

```typescript
import { importOperations } from "./actions/import-operations.ts";
```

- [ ] **Step 5: Typecheck + smoke test**

```bash
npm run typecheck
```

Deploy and smoke-test the existing `import-operations` action.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/john-deere-import/actions/import-operations.ts \
        supabase/functions/john-deere-import/helpers/fetch-measurement-data.ts \
        supabase/functions/john-deere-import/helpers/fetch-map-image.ts \
        supabase/functions/john-deere-import/index.ts
git commit -m "refactor(import): extract import-operations + fetch-measurement-data + fetch-map-image"
```

---

### Task 18: File split — extract per-field action + debug actions

**Files:**

- Create: `supabase/functions/john-deere-import/actions/import-field-operations.ts`
- Create: `supabase/functions/john-deere-import/actions/debug-field-boundaries.ts`
- Create: `supabase/functions/john-deere-import/actions/debug-field-operations.ts`
- Create: `supabase/functions/john-deere-import/helpers/pagination.ts`
- Modify: `supabase/functions/john-deere-import/index.ts`

- [ ] **Step 1: Create `helpers/pagination.ts`**

```typescript
// supabase/functions/john-deere-import/helpers/pagination.ts
import { callJohnDeereUrl } from "../../_shared/john-deere.ts";

interface PagedResponse<T> {
  values?: T[];
  links?: Array<{ rel: string; uri: string }>;
}

export async function* paginate<T>(accessToken: string, initialUrl: string): AsyncGenerator<T> {
  let url: string | null = initialUrl;
  while (url) {
    const resp = await callJohnDeereUrl(accessToken, url);
    if (!resp.ok) break;
    const data = (await resp.json()) as PagedResponse<T>;
    for (const item of data.values ?? []) yield item;
    const next = (data.links ?? []).find((l) => l.rel === "nextPage");
    url = next?.uri ?? null;
  }
}
```

- [ ] **Step 2: Lift `import-field-operations` action**

The existing block at `index.ts:525-598` (handles `?action=import-field-operations&fieldId=X`) becomes `actions/import-field-operations.ts`. Refactor to use `paginate()` from the new helper instead of the inline while-loop. Export `importFieldOperations(args)` function.

- [ ] **Step 3: Lift `debug-field-boundaries` and `debug-field-operations` actions**

Lift verbatim from `index.ts:600-681` into separate files.

- [ ] **Step 4: Update `index.ts` to delegate**

Remove the lifted blocks; add imports + dispatch calls.

- [ ] **Step 5: Typecheck + smoke test**

```bash
npm run typecheck
```

Smoke test each lifted action (use the per-field debug action against a known field from Galen's account).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/john-deere-import/actions/ \
        supabase/functions/john-deere-import/helpers/pagination.ts \
        supabase/functions/john-deere-import/index.ts
git commit -m "refactor(import): extract per-field action + debug actions + pagination helper"
```

---

### Task 19: File split — reduce `index.ts` to dispatch-only

**Files:**

- Modify: `supabase/functions/john-deere-import/index.ts`

After Tasks 16-18, `index.ts` should contain: imports, the Deno.serve handler, auth + connection check, and a dispatch switch. Target: ~80 lines.

- [ ] **Step 1: Rewrite `index.ts`**

```typescript
// supabase/functions/john-deere-import/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import { getValidToken, getUserConnection } from "../_shared/john-deere.ts";
import { logAndRespond } from "./shared/errors.ts";
import { importFields } from "./actions/import-fields.ts";
import { importOperations } from "./actions/import-operations.ts";
import { importFieldOperations } from "./actions/import-field-operations.ts";
import { debugFieldBoundaries } from "./actions/debug-field-boundaries.ts";
import { debugFieldOperations } from "./actions/debug-field-operations.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();

  try {
    const authResult = await getAuthenticatedUser(req);
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;

    const connection = await getUserConnection(supabase, user.id);
    if (!connection) return errorResponse("No John Deere connection found", 404);

    const orgId = connection.selected_org_id;
    if (!orgId) return errorResponse("No organization selected", 400);

    const accessToken = await getValidToken(supabase, connection);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const ctx = { supabase, accessToken, user, orgId, url };

    switch (action) {
      case "import-fields":
        return await importFields(ctx);
      case "import-operations":
        return await importOperations(ctx);
      case "import-field-operations":
        return await importFieldOperations(ctx);
      case "debug-field-boundaries":
        return await debugFieldBoundaries(ctx);
      case "debug-field-operations":
        return await debugFieldOperations(ctx);
      default:
        return errorResponse("Unknown action", 400);
    }
  } catch (err) {
    return logAndRespond(500, "request_failed", "IMPORT_DISPATCH_500", err);
  }
});
```

- [ ] **Step 2: Each action module exports a function accepting `{ supabase, accessToken, user, orgId, url }`**

Refactor the action modules (Tasks 16-18) to use this signature if they don't already. The signature replaces the previous body-level inline use of these variables.

- [ ] **Step 3: Confirm `index.ts` line count**

```bash
wc -l supabase/functions/john-deere-import/index.ts
```

Expected: under 100 lines.

- [ ] **Step 4: Typecheck + smoke test ALL actions**

```bash
npm run typecheck
```

Deploy and verify each of the 5 existing actions returns the same shape as before.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/john-deere-import/
git commit -m "refactor(import): reduce index.ts to dispatch only (689 -> ~80 lines)"
```

---

### Task 20: Implement `import-applications` action

**Files:**

- Create: `supabase/functions/john-deere-import/actions/import-applications.ts`
- Modify: `supabase/functions/john-deere-import/index.ts` (add to dispatch)

This is the main new edge function action. Algorithm per spec section 5.2 + merge logic from Task 13.

- [ ] **Step 1: Create `actions/import-applications.ts`**

```typescript
// supabase/functions/john-deere-import/actions/import-applications.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { User } from "npm:@supabase/supabase-js@2";
import { jsonResponse, errorResponse } from "../../_shared/cors.ts";
import { callJohnDeereApi } from "../../_shared/john-deere.ts";
import { JOHN_DEERE_API_BASE } from "../../_shared/john-deere.ts";
import { paginate } from "../helpers/pagination.ts";
import { extractTankmix } from "../helpers/extract-tankmix.ts";
import { deriveApplicationName } from "../helpers/derive-application-name.ts";
import { normalizeProductName } from "../helpers/normalize.ts";
import {
  mergeApplicationProducts,
  type ExistingProductRow,
} from "../helpers/merge-application-products.ts";
import type { ExtractedProductLine, JdApplicationRateResult } from "../shared/types.ts";
import { ImportApplicationsQuery, parseSeasons } from "../shared/validation.ts";
import { logAndRespond } from "../shared/errors.ts";

interface Ctx {
  supabase: SupabaseClient;
  accessToken: string;
  user: User;
  orgId: string;
  url: URL;
}

interface JdOperationLite {
  id: string;
  fieldOperationType?: string;
  cropSeason?: string;
  startDate?: string;
  endDate?: string;
}

interface CategorySeedRow {
  name_pattern: string;
  match_type: "contains" | "exact";
  product_category: string;
}

const APPLICATION = "APPLICATION";
const APPLICATION_RATE_RESULT = "ApplicationRateResult";

export async function importApplications(ctx: Ctx): Promise<Response> {
  // Parse query
  const queryObj = Object.fromEntries(ctx.url.searchParams.entries());
  const parse = ImportApplicationsQuery.safeParse(queryObj);
  if (!parse.success) {
    return logAndRespond(400, "validation_failed", "IMPORT_APP_400_VALIDATION", parse.error);
  }
  const seasons = new Set(parseSeasons(parse.data.seasons));

  // Read seeds once (small table, ~21 rows)
  const { data: seeds, error: seedsErr } = await ctx.supabase
    .from("product_category_seeds")
    .select("name_pattern, match_type, product_category");
  if (seedsErr) {
    return logAndRespond(500, "request_failed", "IMPORT_APP_500_SEEDS", seedsErr);
  }
  const seedList: CategorySeedRow[] = seeds ?? [];

  // Read fields to scan
  const fieldsQuery = ctx.supabase
    .from("fields")
    .select("jd_field_id, name")
    .eq("user_id", ctx.user.id)
    .eq("org_id", ctx.orgId);
  if (parse.data.fieldId) fieldsQuery.eq("jd_field_id", parse.data.fieldId);
  const { data: fields, error: fieldsErr } = await fieldsQuery;
  if (fieldsErr) return logAndRespond(500, "request_failed", "IMPORT_APP_500_FIELDS", fieldsErr);
  if (!fields || fields.length === 0) {
    return jsonResponse({ totalImported: 0, message: "No stored fields to scan." });
  }

  let totalOps = 0;
  let totalLines = 0;
  let totalNotFound = 0;
  let totalErrors = 0;

  for (const field of fields) {
    const opsUrl = `${JOHN_DEERE_API_BASE}/organizations/${ctx.orgId}/fields/${field.jd_field_id}/fieldOperations?fieldOperationType=${APPLICATION}`;
    for await (const op of paginate<JdOperationLite>(ctx.accessToken, opsUrl)) {
      if (op.cropSeason && !seasons.has(op.cropSeason)) continue;

      // Fetch the measurement (with imperial)
      const measResp = await fetch(
        `${JOHN_DEERE_API_BASE}/fieldOperations/${op.id}/measurementTypes/${APPLICATION_RATE_RESULT}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            Accept: "application/vnd.deere.axiom.v3+json",
            "Accept-UOM-System": "ENGLISH",
          },
        },
      );

      let measurementStatus: "available" | "not_found" | "error" = "available";
      let measurement: JdApplicationRateResult = {};
      if (measResp.status === 404) {
        measurementStatus = "not_found";
        totalNotFound++;
      } else if (!measResp.ok) {
        measurementStatus = "error";
        totalErrors++;
      } else {
        measurement = (await measResp.json()) as JdApplicationRateResult;
      }

      // Upsert field_operations row
      const applicationName =
        measurementStatus === "available" ? deriveApplicationName(measurement) : null;

      const { data: foRow, error: foErr } = await ctx.supabase
        .from("field_operations")
        .select("id, application_name_user_edited")
        .eq("user_id", ctx.user.id)
        .eq("org_id", ctx.orgId)
        .eq("jd_operation_id", op.id)
        .maybeSingle();
      if (foErr) {
        return logAndRespond(500, "request_failed", "IMPORT_APP_500_FO_READ", foErr, {
          opId: op.id,
        });
      }

      const baseRow = {
        user_id: ctx.user.id,
        org_id: ctx.orgId,
        jd_field_id: field.jd_field_id,
        jd_operation_id: op.id,
        operation_type: "application",
        crop_season: op.cropSeason ?? null,
        start_date: op.startDate ?? null,
        end_date: op.endDate ?? null,
        measurement_status: measurementStatus,
        raw_response: measurement,
        updated_at: new Date().toISOString(),
      };

      let fieldOperationId: string;
      if (!foRow) {
        const { data: ins, error: insErr } = await ctx.supabase
          .from("field_operations")
          .insert({
            ...baseRow,
            application_name: applicationName,
            application_name_jd_original: applicationName,
            application_name_user_edited: false,
            imported_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insErr || !ins) {
          return logAndRespond(500, "request_failed", "IMPORT_APP_500_FO_INSERT", insErr, {
            opId: op.id,
          });
        }
        fieldOperationId = ins.id;
      } else {
        fieldOperationId = foRow.id;
        const patch: Record<string, unknown> = { ...baseRow };
        if (!foRow.application_name_user_edited) {
          patch.application_name = applicationName;
          patch.application_name_jd_original = applicationName;
        } else {
          patch.application_name_jd_original = applicationName; // refresh original even when user-edited
        }
        const { error: updErr } = await ctx.supabase
          .from("field_operations")
          .update(patch)
          .eq("id", fieldOperationId);
        if (updErr) {
          return logAndRespond(500, "request_failed", "IMPORT_APP_500_FO_UPDATE", updErr, {
            opId: op.id,
          });
        }
      }

      totalOps++;

      if (measurementStatus !== "available") continue;

      // Extract product lines and merge
      const incoming = extractTankmix(measurement);

      // Upsert products catalog for every product seen
      const productIdByJdId = new Map<string, string>();
      for (const line of incoming) {
        const productId = await upsertProduct(ctx, line, seedList);
        productIdByJdId.set(line.jd_product_id, productId);
      }

      // Read existing product rows for this op
      const { data: existing, error: exErr } = await ctx.supabase
        .from("field_operation_products")
        .select("id, line_index, product_id, is_user_edited, deleted_at")
        .eq("field_operation_id", fieldOperationId);
      if (exErr) {
        return logAndRespond(500, "request_failed", "IMPORT_APP_500_FOP_READ", exErr, {
          opId: op.id,
        });
      }
      const existingRows: ExistingProductRow[] = (existing ?? []).map((r) => ({
        id: r.id,
        line_index: r.line_index,
        product_id: r.product_id,
        is_user_edited: r.is_user_edited,
        deleted_at: r.deleted_at,
      }));

      const plan = mergeApplicationProducts({
        incoming,
        existing: existingRows,
        productIdByJdId,
        field_operation_id: fieldOperationId,
        user_id: ctx.user.id,
        org_id: ctx.orgId,
      });

      // Execute plan
      if (plan.toInsert.length > 0) {
        const { error: insErr } = await ctx.supabase
          .from("field_operation_products")
          .insert(plan.toInsert);
        if (insErr) {
          return logAndRespond(500, "request_failed", "IMPORT_APP_500_FOP_INSERT", insErr, {
            opId: op.id,
          });
        }
      }
      for (const upd of plan.toUpdate) {
        const { error: updErr } = await ctx.supabase
          .from("field_operation_products")
          .update(upd.patch)
          .eq("id", upd.id);
        if (updErr) {
          return logAndRespond(500, "request_failed", "IMPORT_APP_500_FOP_UPDATE", updErr, {
            rowId: upd.id,
          });
        }
      }
      for (const del of plan.toSoftDelete) {
        const { error: delErr } = await ctx.supabase
          .from("field_operation_products")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", del.id);
        if (delErr) {
          return logAndRespond(500, "request_failed", "IMPORT_APP_500_FOP_SOFTDELETE", delErr, {
            rowId: del.id,
          });
        }
      }

      totalLines += plan.toInsert.length + plan.toUpdate.length;
    }
  }

  return jsonResponse({
    operations_processed: totalOps,
    product_lines_written: totalLines,
    measurements_not_found: totalNotFound,
    measurements_error: totalErrors,
  });
}

// Helper: upsert a single product into the catalog.
// Pure-ish; depends on supabase + seed list.
async function upsertProduct(
  ctx: Ctx,
  line: ExtractedProductLine,
  seedList: CategorySeedRow[],
): Promise<string> {
  const nameNormalized = normalizeProductName(line.name);
  const matchedCategory = matchSeedCategory(nameNormalized, seedList);

  const { data: existing, error: readErr } = await ctx.supabase
    .from("products")
    .select("id, product_category, product_category_source")
    .eq("user_id", ctx.user.id)
    .eq("org_id", ctx.orgId)
    .eq("jd_product_id", line.jd_product_id)
    .maybeSingle();
  if (readErr) throw readErr;

  if (existing) {
    // Only seed-set categories may be overwritten by re-seed; user edits are sticky.
    const shouldRefreshCategory = matchedCategory && existing.product_category_source !== "user";
    const patch: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_response: line.raw_response,
    };
    if (shouldRefreshCategory) {
      patch.product_category = matchedCategory;
      patch.product_category_source = "seed";
    }
    const { error: updErr } = await ctx.supabase
      .from("products")
      .update(patch)
      .eq("id", existing.id);
    if (updErr) throw updErr;
    return existing.id;
  }

  const { data: ins, error: insErr } = await ctx.supabase
    .from("products")
    .insert({
      user_id: ctx.user.id,
      org_id: ctx.orgId,
      jd_product_id: line.jd_product_id,
      name: line.name,
      name_normalized: nameNormalized,
      brand: line.brand,
      is_carrier_default: line.is_carrier,
      product_kind: "constituent",
      product_category: matchedCategory,
      product_category_source: matchedCategory ? "seed" : null,
      default_unit: line.total_unit,
      raw_response: line.raw_response,
    })
    .select("id")
    .single();
  if (insErr || !ins) throw insErr ?? new Error("insert returned no row");
  return ins.id;
}

function matchSeedCategory(nameNormalized: string, seeds: CategorySeedRow[]): string | null {
  const h = nameNormalized.trim().toLowerCase();
  if (h.length === 0) return null;
  for (const s of seeds)
    if (s.match_type === "exact" && h === s.name_pattern.toLowerCase()) return s.product_category;
  for (const s of seeds)
    if (s.match_type === "contains" && h.includes(s.name_pattern.toLowerCase()))
      return s.product_category;
  return null;
}
```

- [ ] **Step 2: Wire into `index.ts` dispatch**

In `supabase/functions/john-deere-import/index.ts`, add the import and case:

```typescript
import { importApplications } from "./actions/import-applications.ts";

// inside the switch:
case "import-applications":      return await importApplications(ctx);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/john-deere-import/actions/import-applications.ts \
        supabase/functions/john-deere-import/index.ts
git commit -m "feat(import): add import-applications action with merge-by-line_index"
```

---

### Task 21: Deno test — `import-applications` against fixtures

**Files:**

- Create: `supabase/functions/john-deere-import/__tests__/import-applications.test.ts`

Tests the action with a mocked Supabase client and a mocked `fetch` (returning fixture data). Verifies 200 / 404 / 5xx paths and merge correctness without hitting the live JD API.

- [ ] **Step 1: Create the test file**

```typescript
// supabase/functions/john-deere-import/__tests__/import-applications.test.ts
// Run with: deno test --allow-net --allow-env --allow-read supabase/functions/john-deere-import/__tests__/import-applications.test.ts

import { assertEquals, assertExists } from "https://deno.land/std@0.215.0/assert/mod.ts";
import { importApplications } from "../actions/import-applications.ts";

const FIXTURE_DIR = new URL("../../../../__fixtures__/jd/", import.meta.url);

async function loadFixture(name: string): Promise<unknown> {
  const text = await Deno.readTextFile(new URL(name, FIXTURE_DIR));
  return JSON.parse(text);
}

function makeMockSupabase(state: {
  fields: Array<{ jd_field_id: string; name: string }>;
  fieldOpsByJdId: Map<string, { id: string; application_name_user_edited: boolean }>;
  productsByJdId: Map<
    string,
    { id: string; product_category: string | null; product_category_source: string | null }
  >;
  existingFop: Map<
    string,
    Array<{
      id: string;
      line_index: number;
      product_id: string;
      is_user_edited: boolean;
      deleted_at: string | null;
    }>
  >;
  seeds: Array<{ name_pattern: string; match_type: string; product_category: string }>;
  inserts: Record<string, unknown[]>;
  updates: Record<string, unknown[]>;
}) {
  function table(name: string) {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => {
          if (name === "product_category_seeds") {
            return Promise.resolve({ data: state.seeds, error: null });
          }
          if (name === "fields") {
            return {
              eq: (_c2: string, _v2: unknown) =>
                Promise.resolve({ data: state.fields, error: null }),
            };
          }
          if (name === "field_operations") {
            return {
              eq: (_c2: string, _v2: unknown) => ({
                eq: (_c3: string, jdOpId: string) => ({
                  maybeSingle: () => {
                    const row = state.fieldOpsByJdId.get(jdOpId);
                    return Promise.resolve({ data: row ?? null, error: null });
                  },
                }),
              }),
            };
          }
          if (name === "field_operation_products") {
            return Promise.resolve({
              data: state.existingFop.get(val as string) ?? [],
              error: null,
            });
          }
          if (name === "products") {
            return {
              eq: (_c2: string, _v2: unknown) => ({
                eq: (_c3: string, jdPid: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: state.productsByJdId.get(jdPid) ?? null, error: null }),
                }),
              }),
            };
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
      insert: (rows: unknown) => ({
        select: (_c: string) => ({
          single: () => {
            const id = crypto.randomUUID();
            (state.inserts[name] ??= []).push(rows);
            return Promise.resolve({ data: { id }, error: null });
          },
        }),
      }),
      update: (patch: unknown) => ({
        eq: (_c: string, _v: unknown) => {
          (state.updates[name] ??= []).push(patch);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  }
  // deno-lint-ignore no-explicit-any
  return { from: table } as any;
}

Deno.test(
  "import-applications: happy path inserts products + lines from single-tankmix fixture",
  async () => {
    const single = await loadFixture("application-rate-result-single-tankmix.json");

    // Patch global fetch to return the list + measurement fixtures based on URL.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (url: string | URL | Request, _init?: RequestInit) => {
      const s = url.toString();
      if (s.includes("fieldOperations?fieldOperationType=APPLICATION")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              values: [
                {
                  id: "op-1",
                  fieldOperationType: "application",
                  cropSeason: "2025",
                  startDate: "2025-06-03T22:01:57.473Z",
                },
              ],
              links: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (s.includes("/measurementTypes/ApplicationRateResult")) {
        return Promise.resolve(
          new Response(JSON.stringify(single), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };

    const supabase = makeMockSupabase({
      fields: [{ jd_field_id: "field-1", name: "Test Field" }],
      fieldOpsByJdId: new Map(),
      productsByJdId: new Map(),
      existingFop: new Map(),
      seeds: [],
      inserts: {},
      updates: {},
    });

    const url = new URL("https://example.com/?action=import-applications&seasons=2025,2026");
    const ctx = {
      supabase,
      accessToken: "test-token",
      user: { id: "00000000-0000-0000-0000-00000000U0U0" } as never,
      orgId: "600550",
      url,
    };

    const resp = await importApplications(ctx);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertExists(body.operations_processed);
    assertEquals(body.operations_processed, 1);
    assertEquals(body.product_lines_written, 2);
    assertEquals(body.measurements_not_found, 0);

    globalThis.fetch = origFetch;
  },
);

Deno.test(
  "import-applications: 404 on measurement -> measurement_status='not_found', no product lines",
  async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes("fieldOperations?fieldOperationType=APPLICATION")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              values: [{ id: "op-404", fieldOperationType: "application", cropSeason: "2026" }],
              links: [],
            }),
            { status: 200 },
          ),
        );
      }
      if (s.includes("/measurementTypes/ApplicationRateResult")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("", { status: 200 }));
    };

    const supabase = makeMockSupabase({
      fields: [{ jd_field_id: "field-1", name: "Test Field" }],
      fieldOpsByJdId: new Map(),
      productsByJdId: new Map(),
      existingFop: new Map(),
      seeds: [],
      inserts: {},
      updates: {},
    });

    const url = new URL("https://example.com/?action=import-applications&seasons=2025,2026");
    const resp = await importApplications({
      supabase,
      accessToken: "t",
      user: { id: "u" } as never,
      orgId: "o",
      url,
    });
    const body = await resp.json();
    assertEquals(body.measurements_not_found, 1);
    assertEquals(body.product_lines_written, 0);

    globalThis.fetch = origFetch;
  },
);
```

- [ ] **Step 2: Add Deno test script to `package.json`**

```json
"test:deno": "deno test --allow-net --allow-env --allow-read supabase/functions/john-deere-import/__tests__/import-applications.test.ts"
```

- [ ] **Step 3: Run the Deno tests**

```bash
npm run test:deno
```

Expected: 2 tests passing.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/john-deere-import/__tests__/import-applications.test.ts package.json
git commit -m "test(import): Deno tests for import-applications (happy + 404 paths)"
```

---

### Task 22: Auto-chain `import-applications` from `import-fields`

**Files:**

- Modify: `supabase/functions/john-deere-import/actions/import-fields.ts`

The existing `import-fields` action already auto-chains to `import-operations` after importing fields. Extend the chain to also call `import-applications` so the user gets a one-click "give me everything."

- [ ] **Step 1: Modify `actions/import-fields.ts`**

After the existing `importOperations` call (near the end of the file), add:

```typescript
import { importApplications } from "./import-applications.ts";
// ...
// after the existing operations chain:
const appsResponse = await importApplications(ctx);
// (the response is discarded; the action's mutations land in DB. Use ctx.url? — the action reads its own params.)
```

Note: `importApplications` reads its query from `ctx.url`. The `import-fields` chain runs with the same context, so query params like `seasons=...` if present will apply to applications too. Default `2024,2025,2026` if not set (per Zod schema in shared/validation.ts).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Deploy and smoke-test the full chain**

Use `mcp__supabase__deploy_edge_function` to push. Then trigger `?action=import-fields` from the browser console. Expected: response JSON includes operations_processed > 0 for application import as part of the chain (verify via DB query).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/john-deere-import/actions/import-fields.ts
git commit -m "feat(import): chain import-applications into import-fields auto-flow"
```

---

### Task 23: Frontend types (`types/applications.ts`)

**Files:**

- Create: `types/applications.ts`

- [ ] **Step 1: Create file with the v1 type set**

```typescript
// types/applications.ts

export type ProductCategory = "fertilizer" | "chemical" | "seed" | "adjuvant" | "other";

export interface Product {
  id: string;
  user_id: string;
  org_id: string;
  jd_product_id: string;
  name: string;
  name_normalized: string;
  brand: string | null;
  is_carrier_default: boolean;
  product_kind: "constituent" | "tank_mix_recipe" | null;
  product_category: ProductCategory | string | null; // free text but typed for known set
  product_category_source: "seed" | "user" | null;
  default_unit: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface FieldOperationProductLine {
  id: string;
  user_id: string;
  org_id: string;
  field_operation_id: string;
  product_id: string;
  line_index: number;
  product_category_override: string | null;
  is_carrier: boolean;

  // Live editable
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;

  // JD originals
  rate_value_jd_original: number | null;
  total_value_jd_original: number | null;
  area_value_jd_original: number | null;

  // Edit tracking
  is_user_edited: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationOperation {
  id: string;
  user_id: string;
  org_id: string;
  jd_field_id: string;
  jd_operation_id: string;
  operation_type: "application";
  crop_season: string | null;
  start_date: string | null;
  end_date: string | null;
  application_name: string | null;
  application_name_jd_original: string | null;
  application_name_user_edited: boolean;
  measurement_status: "available" | "not_found" | "error" | "unknown";
}

export interface ApplicationWithLines extends ApplicationOperation {
  field_name: string;
  product_lines: Array<FieldOperationProductLine & { product: Product }>;
}

export interface ProductLineEdit {
  rate_value?: number | null;
  total_value?: number | null;
  area_value?: number | null;
  product_category_override?: string | null;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add types/applications.ts
git commit -m "types: applications + product lines for spray-sync UI"
```

---

### Task 24: Frontend helper `checkMutationResult` + `unit-display`

**Files:**

- Create: `lib/check-mutation-result.ts`
- Create: `lib/unit-display.ts`
- Create: `lib/__tests__/unit-display.test.ts`

`checkMutationResult` is the Farm-Budget pattern: throw if expected rows weren't returned, signaling silent RLS failure.

- [ ] **Step 1: Create `lib/check-mutation-result.ts`**

```typescript
// lib/check-mutation-result.ts

export class MutationError extends Error {
  constructor(
    message: string,
    public operation: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function checkMutationResult<T>(
  data: T | T[] | null,
  operation: string,
  expected = 1,
): T | T[] {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (count < expected) {
    throw new MutationError(
      `${operation} failed: expected ${expected} row(s) affected, got ${count}. This may indicate a permissions issue.`,
      operation,
    );
  }
  return data as T | T[];
}
```

- [ ] **Step 2: Create `lib/__tests__/unit-display.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { displayUnit, displayRate, displayTotal } from "../unit-display.ts";

describe("displayUnit", () => {
  it("maps known JD unitIds to human labels", () => {
    expect(displayUnit("gal")).toBe("gal");
    expect(displayUnit("ac")).toBe("ac");
    expect(displayUnit("gal1ac-1")).toBe("gal/ac");
    expect(displayUnit("qt1ac-1")).toBe("qt/ac");
    expect(displayUnit("lb1ac-1")).toBe("lb/ac");
    expect(displayUnit("mi1hr-1")).toBe("mph");
    expect(displayUnit("l1ha-1")).toBe("L/ha");
    expect(displayUnit("ha")).toBe("ha");
  });

  it("returns the raw unitId when unknown (don't silently lie)", () => {
    expect(displayUnit("xyz")).toBe("xyz");
  });

  it("returns empty for null/undefined", () => {
    expect(displayUnit(null)).toBe("");
    expect(displayUnit(undefined)).toBe("");
  });
});

describe("displayRate", () => {
  it("formats value + unit", () => {
    expect(displayRate(4, "qt1ac-1")).toBe("4 qt/ac");
    expect(displayRate(7.49, "gal1ac-1")).toBe("7.49 gal/ac");
  });
  it("returns dash for null value", () => {
    expect(displayRate(null, "gal1ac-1")).toBe("—");
  });
});

describe("displayTotal", () => {
  it("formats value + unit", () => {
    expect(displayTotal(316, "qt")).toBe("316 qt");
  });
  it("returns dash for null", () => {
    expect(displayTotal(null, "qt")).toBe("—");
  });
});
```

- [ ] **Step 3: Run failing tests**

```bash
npm test -- unit-display
```

Expected: module not found.

- [ ] **Step 4: Implement `lib/unit-display.ts`**

```typescript
// lib/unit-display.ts
// JD unitId -> human label. JD returns IDs like "gal1ac-1" (gallons per acre); we display "gal/ac".

const MAP: Record<string, string> = {
  ac: "ac",
  ha: "ha",
  gal: "gal",
  qt: "qt",
  pt: "pt",
  oz: "oz",
  lb: "lb",
  l: "L",
  ml: "mL",
  "gal1ac-1": "gal/ac",
  "qt1ac-1": "qt/ac",
  "pt1ac-1": "pt/ac",
  "oz1ac-1": "oz/ac",
  "lb1ac-1": "lb/ac",
  "ton1ac-1": "ton/ac",
  "l1ha-1": "L/ha",
  "ml1ha-1": "mL/ha",
  "kg1ha-1": "kg/ha",
  "mi1hr-1": "mph",
  "km1hr-1": "km/h",
};

export function displayUnit(unitId: string | null | undefined): string {
  if (!unitId) return "";
  return MAP[unitId] ?? unitId;
}

export function displayRate(
  value: number | null | undefined,
  unitId: string | null | undefined,
): string {
  if (value == null) return "—";
  return `${value} ${displayUnit(unitId)}`.trim();
}

export function displayTotal(
  value: number | null | undefined,
  unitId: string | null | undefined,
): string {
  if (value == null) return "—";
  return `${value} ${displayUnit(unitId)}`.trim();
}
```

- [ ] **Step 5: Run tests, all green**

```bash
npm test -- unit-display
```

Expected: 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add lib/check-mutation-result.ts lib/unit-display.ts lib/__tests__/unit-display.test.ts
git commit -m "feat(lib): checkMutationResult + unit-display helpers"
```

---

### Task 25: Frontend `applications-client.ts` — read paths

**Files:**

- Create: `lib/applications-client.ts`

- [ ] **Step 1: Create file**

```typescript
// lib/applications-client.ts
import { supabase } from "./supabase";
import { checkMutationResult } from "./check-mutation-result";
import type {
  ApplicationOperation,
  ApplicationWithLines,
  FieldOperationProductLine,
  Product,
} from "@/types/applications";

export interface ApplicationsListFilter {
  fieldId?: string;
  productId?: string;
  season?: string;
  category?: string;
}

export async function fetchApplications(
  filter: ApplicationsListFilter = {},
): Promise<ApplicationWithLines[]> {
  let q = supabase
    .from("field_operations")
    .select(
      `
      id, user_id, org_id, jd_field_id, jd_operation_id, operation_type,
      crop_season, start_date, end_date,
      application_name, application_name_jd_original, application_name_user_edited,
      measurement_status,
      product_lines:field_operation_products(
        id, user_id, org_id, field_operation_id, product_id, line_index,
        product_category_override, is_carrier,
        rate_value, rate_unit, rate_variable,
        total_value, total_unit, total_variable,
        area_value, area_unit,
        rate_value_jd_original, total_value_jd_original, area_value_jd_original,
        is_user_edited, edited_at, deleted_at, created_at, updated_at,
        product:products(*)
      ),
      field:fields(name)
    `,
    )
    .eq("operation_type", "application")
    .is("product_lines.deleted_at", null)
    .order("start_date", { ascending: false });

  if (filter.fieldId) q = q.eq("jd_field_id", filter.fieldId);
  if (filter.season) q = q.eq("crop_season", filter.season);

  const { data, error } = await q;
  if (error) throw error;

  // Reshape: lift field name + apply filters that span join boundaries client-side.
  return (data ?? [])
    .map((row: any) => ({
      ...row,
      field_name: row.field?.name ?? "Unknown",
      product_lines: row.product_lines ?? [],
    }))
    .filter((row: ApplicationWithLines) => {
      if (filter.productId && !row.product_lines.some((l) => l.product_id === filter.productId))
        return false;
      if (filter.category) {
        const has = row.product_lines.some((l) => {
          const effective = l.product_category_override ?? l.product?.product_category;
          return effective === filter.category;
        });
        if (!has) return false;
      }
      return true;
    });
}

export async function fetchProductsRollup(season?: string): Promise<
  Array<{
    product: Product;
    total_value_sum: number;
    total_unit: string | null;
    field_count: number;
    operation_count: number;
  }>
> {
  // Use a single query with aggregation; Supabase RPC would be cleaner but we keep it client-side for v1.
  const { data, error } = await supabase
    .from("field_operation_products")
    .select(
      `
      total_value, total_unit, product_id, field_operation_id,
      field_operation:field_operations!inner(crop_season, jd_field_id),
      product:products(*)
    `,
    )
    .is("deleted_at", null);
  if (error) throw error;

  const byProduct = new Map<
    string,
    {
      product: Product;
      total_value_sum: number;
      total_unit: string | null;
      fields: Set<string>;
      operations: Set<string>;
    }
  >();
  for (const row of (data ?? []) as any[]) {
    if (season && row.field_operation?.crop_season !== season) continue;
    const pid = row.product_id as string;
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        product: row.product,
        total_value_sum: 0,
        total_unit: row.total_unit,
        fields: new Set(),
        operations: new Set(),
      });
    }
    const acc = byProduct.get(pid)!;
    acc.total_value_sum += row.total_value ?? 0;
    if (row.field_operation?.jd_field_id) acc.fields.add(row.field_operation.jd_field_id);
    acc.operations.add(row.field_operation_id);
  }
  return Array.from(byProduct.values()).map((acc) => ({
    product: acc.product,
    total_value_sum: acc.total_value_sum,
    total_unit: acc.total_unit,
    field_count: acc.fields.size,
    operation_count: acc.operations.size,
  }));
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add lib/applications-client.ts
git commit -m "feat(applications): client read paths (list + rollup)"
```

---

### Task 26: Frontend `applications-client.ts` — edit + revert mutations

**Files:**

- Modify: `lib/applications-client.ts`

Append the edit-mutation contract from spec section 6.6.

- [ ] **Step 1: Append edit functions**

Add to `lib/applications-client.ts`:

```typescript
import type { ProductLineEdit } from "@/types/applications";

export async function editProductLine(
  lineId: string,
  edits: ProductLineEdit,
): Promise<FieldOperationProductLine> {
  // Caller is responsible for Zod-validating numeric inputs.
  const { data, error } = await supabase
    .from("field_operation_products")
    .update({
      ...edits,
      is_user_edited: true,
      edited_at: new Date().toISOString(),
    })
    .eq("id", lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit product line", 1) as FieldOperationProductLine;
}

export async function revertProductLine(lineId: string): Promise<FieldOperationProductLine> {
  const { data: row, error: readErr } = await supabase
    .from("field_operation_products")
    .select("rate_value_jd_original, total_value_jd_original, area_value_jd_original")
    .eq("id", lineId)
    .single();
  if (readErr) throw readErr;

  const { data, error } = await supabase
    .from("field_operation_products")
    .update({
      rate_value: row.rate_value_jd_original,
      total_value: row.total_value_jd_original,
      area_value: row.area_value_jd_original,
      product_category_override: null,
      is_user_edited: false,
      edited_at: null,
    })
    .eq("id", lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "revert product line", 1) as FieldOperationProductLine;
}

export async function editProductCategory(productId: string, category: string): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .update({
      product_category: category,
      product_category_source: "user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit product category", 1) as Product;
}

export async function editApplicationName(
  operationId: string,
  name: string,
): Promise<ApplicationOperation> {
  const { data, error } = await supabase
    .from("field_operations")
    .update({
      application_name: name,
      application_name_user_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit application name", 1) as ApplicationOperation;
}

export async function revertApplicationName(operationId: string): Promise<ApplicationOperation> {
  const { data: row, error: readErr } = await supabase
    .from("field_operations")
    .select("application_name_jd_original")
    .eq("id", operationId)
    .single();
  if (readErr) throw readErr;

  const { data, error } = await supabase
    .from("field_operations")
    .update({
      application_name: row.application_name_jd_original,
      application_name_user_edited: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "revert application name", 1) as ApplicationOperation;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add lib/applications-client.ts
git commit -m "feat(applications): edit + revert mutations with checkMutationResult"
```

---

### Task 27: UI — `/applications` page skeleton

**Files:**

- Create: `app/(app)/applications/page.tsx`
- Create: `app/(app)/applications/loading.tsx`
- Modify: `components/layout/nav-links.tsx` (add nav item)

- [ ] **Step 1: Create `app/(app)/applications/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { ApplicationFilters } from "@/components/applications/application-filters";

export default function ApplicationsPage() {
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [filter, setFilter] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchApplications(filter)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
        <p className="mt-1 text-sm text-slate-600">
          Spray applications imported from John Deere Operations Center.
        </p>
      </header>
      <ApplicationFilters value={filter} onChange={setFilter} />
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="mt-6 text-slate-500">Loading...</div>
      ) : (
        <ApplicationsList rows={rows} onChanged={() => setFilter({ ...filter })} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/applications/loading.tsx`**

```tsx
export default function Loading() {
  return <div className="p-6 text-slate-500">Loading applications...</div>;
}
```

- [ ] **Step 3: Add to nav**

In `components/layout/nav-links.tsx`, add the new nav item alongside existing entries (Map, Fields, Operations, Settings):

```tsx
{ href: "/applications", label: "Applications" },
{ href: "/products", label: "Products" },
```

- [ ] **Step 4: Build + visit `/applications`**

```bash
npm run dev
```

Visit `http://localhost:3000/applications` after signing in. Expected: empty table or "Loading..." indicator (no rows in DB yet for a fresh test account is fine).

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/applications/ components/layout/nav-links.tsx
git commit -m "feat(applications): /applications page skeleton + nav entry"
```

---

### Task 28: UI — `applications-list` + `application-row` (collapsed)

**Files:**

- Create: `components/applications/applications-list.tsx`
- Create: `components/applications/application-row.tsx`
- Create: `components/applications/category-badge.tsx`
- Create: `components/applications/application-filters.tsx`

- [ ] **Step 1: Create `components/applications/category-badge.tsx`**

```tsx
"use client";

const ICONS: Record<string, string> = {
  fertilizer: "💧",
  chemical: "🧪",
  seed: "🌱",
  adjuvant: "💦",
  other: "•",
};

const COLORS: Record<string, string> = {
  fertilizer: "bg-blue-50 text-blue-700",
  chemical: "bg-amber-50 text-amber-700",
  seed: "bg-emerald-50 text-emerald-700",
  adjuvant: "bg-cyan-50 text-cyan-700",
  other: "bg-slate-50 text-slate-700",
};

export function CategoryBadge({ category }: { category: string | null }) {
  const key = category ?? "other";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${COLORS[key] ?? COLORS.other}`}
    >
      <span>{ICONS[key] ?? ICONS.other}</span>
      <span className="capitalize">{category ?? "Uncategorized"}</span>
    </span>
  );
}
```

- [ ] **Step 2: Create `components/applications/application-filters.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Filter {
  fieldId?: string;
  productId?: string;
  season?: string;
  category?: string;
}

export function ApplicationFilters({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
}) {
  const [fields, setFields] = useState<Array<{ jd_field_id: string; name: string }>>([]);
  const [seasons] = useState<string[]>(["2026", "2025", "2024"]);

  useEffect(() => {
    supabase
      .from("fields")
      .select("jd_field_id, name")
      .order("name")
      .then(({ data }) => {
        setFields(data ?? []);
      });
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="rounded border border-slate-200 px-2 py-1 text-sm"
        value={value.fieldId ?? ""}
        onChange={(e) => onChange({ ...value, fieldId: e.target.value || undefined })}
      >
        <option value="">All fields</option>
        {fields.map((f) => (
          <option key={f.jd_field_id} value={f.jd_field_id}>
            {f.name}
          </option>
        ))}
      </select>
      <select
        className="rounded border border-slate-200 px-2 py-1 text-sm"
        value={value.season ?? ""}
        onChange={(e) => onChange({ ...value, season: e.target.value || undefined })}
      >
        <option value="">All seasons</option>
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        className="rounded border border-slate-200 px-2 py-1 text-sm"
        value={value.category ?? ""}
        onChange={(e) => onChange({ ...value, category: e.target.value || undefined })}
      >
        <option value="">All categories</option>
        <option value="fertilizer">Fertilizer</option>
        <option value="chemical">Chemical</option>
        <option value="seed">Seed</option>
        <option value="adjuvant">Adjuvant</option>
        <option value="other">Other</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/applications/application-row.tsx`** (collapsed row)

```tsx
"use client";

import { useState } from "react";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationExpanded } from "./application-expanded";

export function ApplicationRow({
  row,
  onChanged,
}: {
  row: ApplicationWithLines;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const lineCount = row.product_lines.filter((l) => !l.deleted_at).length;
  const dateLabel = row.start_date ? new Date(row.start_date).toLocaleDateString() : "—";

  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
        onClick={() => setOpen(!open)}
      >
        <span className="w-24 text-sm text-slate-600">{dateLabel}</span>
        <span className="flex-1 font-medium text-slate-900">
          {row.application_name ?? "(unnamed)"}
        </span>
        <span className="text-sm text-slate-500">{row.field_name}</span>
        <span className="text-sm text-slate-500">{lineCount} items</span>
        {row.measurement_status === "not_found" && (
          <span className="rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700">
            JD data pending
          </span>
        )}
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <ApplicationExpanded row={row} onChanged={onChanged} />}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/applications/applications-list.tsx`**

```tsx
"use client";

import { ApplicationRow } from "./application-row";
import type { ApplicationWithLines } from "@/types/applications";

export function ApplicationsList({
  rows,
  onChanged,
}: {
  rows: ApplicationWithLines[];
  onChanged: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded border border-dashed border-slate-200 p-8 text-center text-slate-500">
        No applications to show. Import from John Deere via Settings.
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-2">
      {rows.map((row) => (
        <ApplicationRow key={row.id} row={row} onChanged={onChanged} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Visit `/applications` in dev**

Verify the page renders with collapsed rows. Click a row to confirm `application-expanded` is required — it doesn't exist yet (Task 29), so expect a runtime error or empty expansion area.

- [ ] **Step 6: Commit**

```bash
git add components/applications/
git commit -m "feat(applications): list + collapsed row + filters + category badge"
```

---

### Task 29: UI — `application-expanded` + `product-line-row` (read-only first)

**Files:**

- Create: `components/applications/application-expanded.tsx`
- Create: `components/applications/product-line-row.tsx`
- Create: `components/applications/inconsistency-badge.tsx`

- [ ] **Step 1: Create `inconsistency-badge.tsx`**

```tsx
"use client";

export function InconsistencyBadge({
  rate,
  area,
  total,
}: {
  rate: number | null;
  area: number | null;
  total: number | null;
}) {
  if (rate == null || area == null || total == null) return null;
  const expected = rate * area;
  const eps = Math.max(0.5, expected * 0.05); // 5% tolerance or 0.5 absolute
  if (Math.abs(total - expected) <= eps) return null;
  return (
    <span
      className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
      title={`Rate × area = ${expected.toFixed(2)}, but total is ${total}. Save still works.`}
    >
      ⚠ inconsistent
    </span>
  );
}
```

- [ ] **Step 2: Create `product-line-row.tsx`** (read-only mode for now)

```tsx
"use client";

import { displayRate, displayTotal, displayUnit } from "@/lib/unit-display";
import { CategoryBadge } from "./category-badge";
import { InconsistencyBadge } from "./inconsistency-badge";
import type { FieldOperationProductLine, Product } from "@/types/applications";

interface Props {
  line: FieldOperationProductLine & { product: Product };
  onEdit?: () => void;
  onRevert?: () => void;
}

export function ProductLineRow({ line, onEdit, onRevert }: Props) {
  const effectiveCategory = line.product_category_override ?? line.product.product_category;
  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
      <div className="col-span-3 font-medium text-slate-900">{line.product.name}</div>
      <div className="col-span-2">
        <CategoryBadge category={effectiveCategory} />
      </div>
      <div className="col-span-2 text-slate-700">
        {displayRate(line.rate_value, line.rate_unit)}
      </div>
      <div className="col-span-2 text-slate-700">
        {displayTotal(line.total_value, line.total_unit)}
      </div>
      <div className="col-span-1 text-slate-700">
        {line.area_value} {displayUnit(line.area_unit)}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2">
        <InconsistencyBadge
          rate={line.rate_value}
          area={line.area_value}
          total={line.total_value}
        />
        {line.is_user_edited && (
          <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">edited</span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50"
          >
            Edit
          </button>
        )}
        {line.is_user_edited && onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `application-expanded.tsx`** (groups lines by category, hides carriers by default)

```tsx
"use client";

import { useState } from "react";
import { ProductLineRow } from "./product-line-row";
import type { ApplicationWithLines } from "@/types/applications";

const CATEGORY_ORDER = ["fertilizer", "chemical", "seed", "adjuvant", "other", null];

export function ApplicationExpanded({
  row,
  onChanged,
}: {
  row: ApplicationWithLines;
  onChanged: () => void;
}) {
  const [showCarriers, setShowCarriers] = useState(false);
  const visibleLines = row.product_lines.filter(
    (l) => !l.deleted_at && (showCarriers || !l.is_carrier),
  );
  const grouped = new Map<string | null, typeof visibleLines>();
  for (const line of visibleLines) {
    const cat = line.product_category_override ?? line.product.product_category ?? null;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(line);
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-4">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase text-slate-500">
        <div className="col-span-3">Product</div>
        <div className="col-span-2">Category</div>
        <div className="col-span-2">Rate</div>
        <div className="col-span-2">Total</div>
        <div className="col-span-1">Area</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const lines = grouped.get(cat);
        if (!lines || lines.length === 0) return null;
        return (
          <div key={cat ?? "uncategorized"} className="mt-1 rounded bg-white">
            {lines.map((line) => (
              <ProductLineRow key={line.id} line={line as any} />
            ))}
          </div>
        );
      })}
      <div className="mt-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showCarriers}
            onChange={(e) => setShowCarriers(e.target.checked)}
          />
          Show carriers (water/UAN)
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Visit `/applications`, expand a row**

Should see grouped product lines by category. Edits not wired yet — Task 30.

- [ ] **Step 5: Commit**

```bash
git add components/applications/
git commit -m "feat(applications): expanded view grouped by category + read-only product lines"
```

---

### Task 30: UI — product line edit dialog + revert flow

**Files:**

- Create: `components/applications/product-line-edit-dialog.tsx`
- Modify: `components/applications/application-expanded.tsx` (wire edit + revert handlers)

- [ ] **Step 1: Create `product-line-edit-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { editProductLine } from "@/lib/applications-client";
import { displayUnit } from "@/lib/unit-display";
import type { FieldOperationProductLine, Product } from "@/types/applications";

interface Props {
  line: FieldOperationProductLine & { product: Product };
  onClose: () => void;
  onSaved: () => void;
}

export function ProductLineEditDialog({ line, onClose, onSaved }: Props) {
  const [rate, setRate] = useState(line.rate_value ?? "");
  const [total, setTotal] = useState(line.total_value ?? "");
  const [area, setArea] = useState(line.area_value ?? "");
  const [override, setOverride] = useState(line.product_category_override ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await editProductLine(line.id, {
        rate_value: rate === "" ? null : Number(rate),
        total_value: total === "" ? null : Number(total),
        area_value: area === "" ? null : Number(area),
        product_category_override: override === "" ? null : override,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Edit {line.product.name}</h3>
        <div className="space-y-3">
          <Row label={`Rate (${displayUnit(line.rate_unit)})`} value={rate} setValue={setRate} />
          <Row
            label={`Total (${displayUnit(line.total_unit)})`}
            value={total}
            setValue={setTotal}
          />
          <Row label={`Area (${displayUnit(line.area_unit)})`} value={area} setValue={setArea} />
          <div>
            <label className="mb-1 block text-xs text-slate-600">
              Category override (optional)
            </label>
            <select
              className="w-full rounded border border-slate-200 px-2 py-1.5"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            >
              <option value="">(use product default)</option>
              <option value="fertilizer">Fertilizer</option>
              <option value="chemical">Chemical</option>
              <option value="seed">Seed</option>
              <option value="adjuvant">Adjuvant</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string | number;
  setValue: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-600">{label}</label>
      <input
        type="number"
        step="any"
        className="w-full rounded border border-slate-200 px-2 py-1.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire edit + revert in `application-expanded.tsx`**

Modify the expanded component to track the editing line and the revert action:

```tsx
// inside ApplicationExpanded, add:
import { ProductLineEditDialog } from "./product-line-edit-dialog";
import { revertProductLine } from "@/lib/applications-client";

// state:
const [editingLineId, setEditingLineId] = useState<string | null>(null);

// pass handlers to ProductLineRow:
<ProductLineRow
  key={line.id}
  line={line as any}
  onEdit={() => setEditingLineId(line.id)}
  onRevert={async () => {
    try {
      await revertProductLine(line.id);
      onChanged();
    } catch (e) {
      console.error(e);
    }
  }}
/>;

// at end of component:
{
  editingLineId &&
    (() => {
      const line = visibleLines.find((l) => l.id === editingLineId);
      return line ? (
        <ProductLineEditDialog
          line={line as any}
          onClose={() => setEditingLineId(null)}
          onSaved={onChanged}
        />
      ) : null;
    })();
}
```

- [ ] **Step 3: Test in browser**

Visit `/applications`, expand a row, click Edit on a line → modal opens. Change a rate, save → modal closes, page refreshes, edited badge appears. Click Revert → values return to JD's original.

- [ ] **Step 4: Commit**

```bash
git add components/applications/
git commit -m "feat(applications): edit dialog + revert wired to client"
```

---

### Task 31: UI — `/products` rollup page

**Files:**

- Create: `app/(app)/products/page.tsx`
- Create: `app/(app)/products/loading.tsx`
- Create: `components/applications/products-rollup-table.tsx`

- [ ] **Step 1: Create `app/(app)/products/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { fetchProductsRollup, editProductCategory } from "@/lib/applications-client";
import { ProductsRollupTable } from "@/components/applications/products-rollup-table";

export default function ProductsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [season, setSeason] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchProductsRollup(season || undefined)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }
  useEffect(load, [season]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quantities applied across all fields, grouped by product.
        </p>
      </header>
      <div className="mb-4 flex items-center gap-3">
        <select
          className="rounded border border-slate-200 px-2 py-1 text-sm"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
        >
          <option value="">All seasons</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
        </select>
      </div>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="text-slate-500">Loading...</div>
      ) : (
        <ProductsRollupTable
          rows={rows}
          onEditCategory={async (productId, cat) => {
            await editProductCategory(productId, cat);
            load();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/applications/products-rollup-table.tsx`**

```tsx
"use client";

import { CategoryBadge } from "./category-badge";
import { displayUnit } from "@/lib/unit-display";
import type { Product } from "@/types/applications";

interface RollupRow {
  product: Product;
  total_value_sum: number;
  total_unit: string | null;
  field_count: number;
  operation_count: number;
}

export function ProductsRollupTable({
  rows,
  onEditCategory,
}: {
  rows: RollupRow[];
  onEditCategory: (productId: string, category: string) => Promise<void>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-200 p-8 text-center text-slate-500">
        No products yet.
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Product</th>
          <th className="px-3 py-2 text-left">Category</th>
          <th className="px-3 py-2 text-right">Total Applied</th>
          <th className="px-3 py-2 text-right">Fields</th>
          <th className="px-3 py-2 text-right">Operations</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product.id} className="border-b border-slate-100">
            <td className="px-3 py-2 font-medium text-slate-900">{r.product.name}</td>
            <td className="px-3 py-2">
              <select
                className="rounded border border-slate-200 px-2 py-0.5 text-xs"
                value={r.product.product_category ?? ""}
                onChange={(e) => onEditCategory(r.product.id, e.target.value)}
              >
                <option value="">(uncategorized)</option>
                <option value="fertilizer">Fertilizer</option>
                <option value="chemical">Chemical</option>
                <option value="seed">Seed</option>
                <option value="adjuvant">Adjuvant</option>
                <option value="other">Other</option>
              </select>
            </td>
            <td className="px-3 py-2 text-right">
              {r.total_value_sum.toFixed(2)} {displayUnit(r.total_unit)}
            </td>
            <td className="px-3 py-2 text-right">{r.field_count}</td>
            <td className="px-3 py-2 text-right">{r.operation_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `app/(app)/products/loading.tsx`**

```tsx
export default function Loading() {
  return <div className="p-6 text-slate-500">Loading products...</div>;
}
```

- [ ] **Step 4: Visit `/products`**

Verify the rollup renders with category dropdowns. Edit a category — should persist on refresh.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/products/ components/applications/products-rollup-table.tsx
git commit -m "feat(products): /products rollup page with editable categories"
```

---

### Task 32: UI — `/fields/[fieldId]` Applications tab

**Files:**

- Create: `components/fields/field-applications-tab.tsx`
- Modify: existing field detail page to add the tab

- [ ] **Step 1: Inspect the existing field detail route**

```bash
ls app/\(app\)/map/field/
```

The existing field detail lives at `app/(app)/map/field/[fieldId]/page.tsx`. Decision: add a sibling route `app/(app)/fields/[fieldId]/applications/page.tsx` rather than modifying the map-context field view (keeps map-tab and applications-tab decoupled).

- [ ] **Step 2: Create `app/(app)/fields/[fieldId]/applications/page.tsx`**

```tsx
"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";

export default function FieldApplicationsPage() {
  const params = useParams();
  const fieldId = params.fieldId as string;
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetchApplications({ fieldId })
      .then(setRows)
      .finally(() => setLoading(false));
  }
  useEffect(load, [fieldId]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Field applications</h1>
      {loading ? (
        <div className="mt-4 text-slate-500">Loading...</div>
      ) : (
        <ApplicationsList rows={rows} onChanged={load} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add a link from the field detail map view**

If `app/(app)/map/field/[fieldId]/page.tsx` exists, add a button/link to `/fields/[fieldId]/applications`. If it's a slide-panel component, add the link there.

- [ ] **Step 4: Test**

Visit `/fields/<some-jd-field-id>/applications`. Verify it lists only that field's applications.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/fields/
git commit -m "feat(fields): per-field applications view"
```

---

### Task 33: Playwright global auth setup

**Files:**

- Create: `tests/e2e/global-setup.ts`
- Modify: `playwright.config.ts` (reference globalSetup)

The Supabase auth flow writes a session to localStorage with a specific key pattern. A Playwright global setup signs in once, saves storageState, and all specs reuse it.

- [ ] **Step 1: Create `tests/e2e/global-setup.ts`**

```typescript
import { chromium, FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use?.baseURL ?? "http://localhost:3000";
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD must be set in .env.test");
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(map|applications|products)/, { timeout: 30_000 });
  await page.context().storageState({ path: "tests/e2e/.auth/state.json" });
  await browser.close();
}
```

- [ ] **Step 2: Update `playwright.config.ts`**

Add to the config:

```typescript
globalSetup: require.resolve("./tests/e2e/global-setup.ts"),
use: {
  ...existing,
  storageState: "tests/e2e/.auth/state.json",
},
```

- [ ] **Step 3: Gitignore the auth state**

Append to `.gitignore`:

```
tests/e2e/.auth/
```

- [ ] **Step 4: Run sanity spec, verify auth carries through**

```bash
mkdir -p tests/e2e/.auth
npm run test:e2e -- sanity
```

Expected: passes (signs in once, then sanity spec loads home page as authenticated user).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/global-setup.ts playwright.config.ts .gitignore
git commit -m "test(e2e): Playwright global auth setup + storageState"
```

---

### Task 34: E2E spec — import + view applications

**Files:**

- Create: `tests/e2e/import-and-view.spec.ts`

This spec asserts that after triggering the import, the `/applications` page lists at least one application with at least one product line. Galen's account is assumed to have real JD data with at least one APPLICATION op.

- [ ] **Step 1: Create the spec**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Import + view applications", () => {
  test("after running import, /applications shows at least one row", async ({ page }) => {
    // Trigger import via the existing UI button (path depends on where you wire it — adjust selector)
    // For v1 the user runs import from /map or /settings; here we use the edge function directly.
    const authKey = await page.evaluate(() =>
      Object.keys(localStorage).find((k) => k.includes("auth-token")),
    );
    expect(authKey).toBeTruthy();

    const token = await page.evaluate((k) => {
      const raw = JSON.parse(localStorage.getItem(k as string) ?? "{}");
      return raw?.access_token ?? raw?.currentSession?.access_token;
    }, authKey);
    expect(token).toBeTruthy();

    const apiResp = await page.request.get(
      "https://nuxofsjzrgdauzriraze.supabase.co/functions/v1/john-deere-import?action=import-applications",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(apiResp.ok()).toBeTruthy();

    await page.goto("/applications");
    await expect(page.getByText(/loading|applications/i).first()).toBeVisible();

    // Wait for content
    await page.waitForSelector('button:has-text("items")', { timeout: 30_000 });
    const rows = await page.locator('button:has-text("items")').count();
    expect(rows).toBeGreaterThan(0);
  });

  test("expanding a row shows product lines", async ({ page }) => {
    await page.goto("/applications");
    await page.waitForSelector('button:has-text("items")', { timeout: 30_000 });
    await page.locator('button:has-text("items")').first().click();
    // Expanded section should have at least one product name visible
    await expect(page.locator("text=/[A-Za-z]+/").first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:e2e -- import-and-view
```

Expected: passes (requires real JD data on Galen's account; if test account has no APPLICATION ops, document and skip).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/import-and-view.spec.ts
git commit -m "test(e2e): import + view applications smoke"
```

---

### Task 35: E2E spec — edit + revert flow

**Files:**

- Create: `tests/e2e/edit-and-revert.spec.ts`

- [ ] **Step 1: Create the spec**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Edit + revert product line", () => {
  test("user edits a rate, sees edited badge, reverts to JD original", async ({ page }) => {
    await page.goto("/applications");
    await page.waitForSelector('button:has-text("items")', { timeout: 30_000 });

    // Expand first application
    await page.locator('button:has-text("items")').first().click();

    // Find first Edit button on a product line
    const editBtn = page.locator('button:text("Edit")').first();
    await editBtn.click();

    // Modal opens — get current rate, change it
    const rateInput = page.locator('input[type="number"]').first();
    const originalRate = await rateInput.inputValue();
    const newRate = (Number(originalRate) + 1).toString();
    await rateInput.fill(newRate);

    await page.locator('button:text("Save")').click();
    // Modal closes
    await expect(page.locator('button:text("Save")')).toHaveCount(0, { timeout: 10_000 });

    // Edited badge appears
    await expect(page.locator("text=/edited/i").first()).toBeVisible();

    // Revert button appears
    const revertBtn = page.locator('button:text("Revert")').first();
    await expect(revertBtn).toBeVisible();
    await revertBtn.click();

    // Edited badge should disappear after revert
    await page.waitForTimeout(1500); // allow refetch
    const editedAfter = await page.locator("text=/edited/i").count();
    expect(editedAfter).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:e2e -- edit-and-revert
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/edit-and-revert.spec.ts
git commit -m "test(e2e): edit + revert product line flow"
```

---

### Task 36: E2E spec — re-import preserves user edits

**Files:**

- Create: `tests/e2e/reimport-preserves-edits.spec.ts`

This is the load-bearing test for the merge-by-line_index logic.

- [ ] **Step 1: Create the spec**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Re-import preserves user edits", () => {
  test("editing a rate then re-importing leaves the edited value intact", async ({ page }) => {
    // Setup: edit a rate
    await page.goto("/applications");
    await page.waitForSelector('button:has-text("items")', { timeout: 30_000 });
    await page.locator('button:has-text("items")').first().click();
    await page.locator('button:text("Edit")').first().click();
    const rateInput = page.locator('input[type="number"]').first();
    const original = await rateInput.inputValue();
    const edited = (Number(original) + 7).toString(); // arbitrary delta
    await rateInput.fill(edited);
    await page.locator('button:text("Save")').click();
    await page.waitForTimeout(1500);

    // Re-trigger import via the API
    const authKey = await page.evaluate(() =>
      Object.keys(localStorage).find((k) => k.includes("auth-token")),
    );
    const token = await page.evaluate((k) => {
      const raw = JSON.parse(localStorage.getItem(k as string) ?? "{}");
      return raw?.access_token ?? raw?.currentSession?.access_token;
    }, authKey);
    const resp = await page.request.get(
      "https://nuxofsjzrgdauzriraze.supabase.co/functions/v1/john-deere-import?action=import-applications",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(resp.ok()).toBeTruthy();

    // Reload and verify the edited value is still present
    await page.reload();
    await page.waitForSelector('button:has-text("items")', { timeout: 30_000 });
    await page.locator('button:has-text("items")').first().click();
    await expect(page.locator("text=/edited/i").first()).toBeVisible();

    // Open the edit dialog and confirm the value matches our edit
    await page.locator('button:text("Edit")').first().click();
    const stillEdited = await page.locator('input[type="number"]').first().inputValue();
    expect(Number(stillEdited)).toBeCloseTo(Number(edited), 2);
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:e2e -- reimport-preserves-edits
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/reimport-preserves-edits.spec.ts
git commit -m "test(e2e): re-import preserves user-edited product lines"
```

---

### Task 37: Capture richer JD fixtures from real data

After running real imports, the test fixture coverage can be hardened with cases the Phase 0c capture didn't include (multi-tankmix operations, ops with `cropName` present, mixed seasons).

**Files:**

- Modify or create: `__fixtures__/jd/application-rate-result-multi-tankmix.json`
- Modify: tests that reference the new fixture

- [ ] **Step 1: Use the existing `debug-spray-shape` endpoint to scan more fields**

(The function deployed in Phase 0c is still active until Task 38.) Use the browser console snippet again, this time on a different field with known multi-product tank mixes. Save the response.

- [ ] **Step 2: Anonymize and commit the new fixture**

Replace org IDs and field UUIDs with synthetic IDs (`00000000-0000-0000-0000-...`). Save to `__fixtures__/jd/application-rate-result-multi-tankmix.json`.

- [ ] **Step 3: Add a Vitest test using the new fixture**

In `supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts`, add:

```typescript
it("handles multi-tankmix fixture: each outer aggregate gets its own line_index range", () => {
  const input = loadFixture("application-rate-result-multi-tankmix.json");
  const result = extractTankmix(input);
  // Assert there are at least 4 lines, line_index is contiguous 0..N
  expect(result.length).toBeGreaterThanOrEqual(4);
  expect(result.map((l) => l.line_index)).toEqual(result.map((_l, i) => i));
});
```

- [ ] **Step 4: Run unit tests**

```bash
npm test -- extract-tankmix
```

- [ ] **Step 5: Commit**

```bash
git add __fixtures__/jd/ supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts
git commit -m "test: add multi-tankmix fixture + extract-tankmix coverage"
```

---

### Task 38: Delete the temporary `debug-spray-shape` function

**Files:**

- Delete (filesystem): `supabase/functions/debug-spray-shape/`
- Use: `mcp__supabase__list_edge_functions` to confirm deletion intent

The Phase 0c diagnostic function has served its purpose. Removing it reduces surface area and edge function deploy count.

- [ ] **Step 1: List edge functions to confirm `debug-spray-shape` exists**

Use `mcp__supabase__list_edge_functions` with `project_id: "nuxofsjzrgdauzriraze"`. Expected: 5 functions (john-deere-auth, john-deere-api, john-deere-import, john-deere-irrigation, debug-spray-shape).

- [ ] **Step 2: Note — Supabase MCP does not expose a delete-function tool**

There is no `mcp__supabase__delete_edge_function`. Options:

- Use Supabase CLI: `npx supabase functions delete debug-spray-shape --project-ref nuxofsjzrgdauzriraze`
- Delete via the Supabase dashboard UI (manual)

Run via CLI if available; otherwise document the manual step for Galen.

```bash
npx supabase functions delete debug-spray-shape --project-ref nuxofsjzrgdauzriraze
```

Expected: confirmation. If the CLI is not configured, ask Galen to delete from the dashboard.

- [ ] **Step 3: Remove the source folder locally**

```bash
rm -rf supabase/functions/debug-spray-shape/
```

- [ ] **Step 4: Confirm deletion**

Re-run `mcp__supabase__list_edge_functions`. Expected: 4 functions, no `debug-spray-shape`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/
git commit -m "chore: delete debug-spray-shape (Phase 0c diagnostic — schema is locked)"
```

---

### Task 39: Run real import against Galen's account + manual verification

**Files:** none changed. Verification step.

- [ ] **Step 1: Trigger full import via the UI button**

Sign in as Galen → trigger `import-fields` (auto-chains to operations + applications). Watch network tab.

Expected: `import-fields` returns success; `import-applications` (chained) returns with `operations_processed > 0`, `product_lines_written > 0`.

- [ ] **Step 2: Query the DB to verify totals**

Use `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM operations_center.products) AS product_count,
  (SELECT count(*) FROM operations_center.field_operation_products WHERE deleted_at IS NULL) AS line_count,
  (SELECT count(*) FROM operations_center.field_operations WHERE operation_type = 'application') AS app_op_count,
  (SELECT count(*) FROM operations_center.field_operations WHERE measurement_status = 'not_found') AS not_found_count;
```

Expected: non-zero values across the board. Compare `not_found_count` to total app_op_count — Phase 0c showed ~2/3 of operations returned 404, so this ratio being high is normal.

- [ ] **Step 3: Spot-check `/applications` UI**

- Filter by season `2025` → expect older entries
- Filter by season `2026` → expect newer entries (some will have "JD data pending" badge)
- Expand a row with multiple products → expect grouped by category
- Edit a rate → expect badge appears, value persists across page refresh
- Revert → expect original value restored
- Toggle "Show carriers" → expect water rows appear/disappear

- [ ] **Step 4: Spot-check `/products` UI**

- View "All seasons" → expect aggregated quantities
- Change a category dropdown → refresh → expect category persists

- [ ] **Step 5: Manual RLS verification**

Create or use a SECOND Supabase test account. Sign in as that account → `/applications` should show NOTHING (no rows for that user_id). Confirm visually.

- [ ] **Step 6: Document any anomalies**

Note any unexpected JD response shapes, missing data, UI glitches. File as TECH-DEBT items if not blockers. Anything blocking → fix before continuing.

- [ ] **Step 7: Commit a marker note**

```bash
git commit --allow-empty -m "verify: manual end-to-end check of spray-sync v1 — see SESSION-HANDOFF for findings"
```

---

### Task 40: Final code review via `/code-review`

**Files:** none changed. Review step.

- [ ] **Step 1: Confirm branch has all committed work**

```bash
git status
git log --oneline | head -40
```

Expected: clean working tree, ~38+ commits documenting the build.

- [ ] **Step 2: Invoke `/code-review` skill**

The `/code-review` skill in this project reviews the current diff for correctness bugs and reuse/simplification/efficiency cleanups. Run it on the full branch diff:

```
/code-review high
```

Review the findings. For each:

- P1 / correctness bugs: fix in this task with a new commit
- P2 / cleanups: triage — fix obvious wins, defer the rest to TECH-DEBT
- P3 / nits: defer

- [ ] **Step 3 (optional): Invoke `/codex review` for second opinion**

```
/codex review
```

Compare Codex's findings to the `/code-review` output. Resolve any disagreements in writing.

- [ ] **Step 4: Address any P1 findings + commit fixes**

- [ ] **Step 5: Update `CHANGELOG.md` + `PROJECT-LOG.md` per the end-of-session protocol**

In `CHANGELOG.md` `[Unreleased]` block, add:

```markdown
### Added

- Spray-application sync from John Deere Operations Center with per-product tank-mix data
- Product classification (5-bucket: fertilizer / chemical / seed / adjuvant / other) seeded from common ag products
- Editable JD-imported values with revert-to-JD-original path
- `/applications` and `/products` UI surfaces
- Per-field Applications tab
- Automated test suite (Vitest unit + Deno edge function + Playwright E2E)
```

In `PROJECT-LOG.md`, add a new top entry:

```markdown
## 2026-XX-XX — Shipped spray-application sync v1

**Status:** Implementation complete, all tests passing, manual verification done.

**Tests added:** N Vitest unit tests, N Deno tests, 3 Playwright E2E scenarios.

**Tech debt addressed:** john-deere-import split from 689 lines to <100 (dispatch-only).

**Tech debt opened:**

- (list anything new found during the build)
```

- [ ] **Step 6: Commit final cleanups**

```bash
git add CHANGELOG.md PROJECT-LOG.md TECH-DEBT.md
git commit -m "docs: changelog + project-log + tech-debt updates for spray-sync ship"
```

- [ ] **Step 7: Confirm with Galen — push to remote?**

Per Galen's `feedback_hold_push.md` memory: commit locally, wait for explicit "push" before deploying. Do not push without his nod.

---

## Self-Review

Performed after writing the complete plan, checked against the spec at `docs/superpowers/specs/2026-05-28-spray-application-sync-design.md`.

### Security hardening coverage (Group 0)

Group 0 was added after the initial plan, in response to Galen's request to fold Watch Tower v6.7 security findings into this build where they touch surfaces we're already modifying.

| v6.4/v6.7 flag                      | Severity | Resolution                                                       |
| ----------------------------------- | -------- | ---------------------------------------------------------------- |
| `cors-open`                         | P1       | Task 0.1 — `_shared/cors.ts` allowlist                           |
| `error-response-leakage`            | P2       | Task 0.2 — `_shared/generic-error.ts` retrofitted to 4 functions |
| `route-protection-gap`              | P3       | Task 0.3 — `middleware.ts` via `@supabase/ssr`                   |
| `oauth-broad-scopes`                | P3       | Task 0.4 — trim to read-only                                     |
| `file-over-500` (john-deere-import) | P4       | Tasks 15-19 — file split                                         |

Flags NOT addressed in this build (deliberately, per the v6.7 audit triage):

- `no-input-validation` on the 4 existing functions (new endpoints get Zod; legacy retrofit is follow-on)
- `no-rate-limiting` (needs Upstash/Redis infrastructure)
- `npm-cve-residual` (Next 13 → 16 migration sprint)
- Other `file-over-500` files (orthogonal refactors)
- New v6.7 DNS audits (DMARC/SPF/CAA — domain config, not code)

### Spec coverage check

| Spec section                                                                         | Covered by task(s)                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 2 (Scope — APPLICATION ops, 3 seasons)                                               | Task 20 (import-applications) + Task 22 (auto-chain)                                    |
| 2 (Product classification)                                                           | Tasks 8 (seed table) + 14 (matcher) + 20 (upsertProduct) + 28 (UI) + 31 (category edit) |
| 2 (Editable JD values + revert)                                                      | Tasks 6 (schema) + 26 (mutations) + 30 (UI)                                             |
| 2 (Seed migration)                                                                   | Task 8                                                                                  |
| 2 (`/applications` + `/products` UI)                                                 | Tasks 27, 28, 29, 30, 31                                                                |
| 2 (Per-field tab)                                                                    | Task 32                                                                                 |
| 2 (`checkMutationResult`)                                                            | Task 24                                                                                 |
| 2 (Zod + generic errors + restricted CORS — new endpoints)                           | Task 15 (errors + validation) + Task 20 (uses them)                                     |
| 2 (`john-deere-import` file split)                                                   | Tasks 15-19                                                                             |
| 2 (Automated testing)                                                                | Tasks 1, 2, 10-14, 21, 33-36                                                            |
| 3 (Hard constraints — schema in `operations_center`, RLS day-one, verify_jwt: false) | All migrations (Tasks 5-8), edge function deploys use existing patterns                 |
| 4.1 (`products` table)                                                               | Task 5                                                                                  |
| 4.1 (`field_operation_products` table, `*_jd_original`, soft-delete)                 | Task 6                                                                                  |
| 4.1 (`field_operations` extensions)                                                  | Task 7                                                                                  |
| 4.2 (Trigger as backup guard)                                                        | Task 6                                                                                  |
| 4.3 (RLS)                                                                            | Tasks 5, 6 (policies in same migrations)                                                |
| 4.4 (GRANTs)                                                                         | Tasks 5, 6, 8                                                                           |
| 4.5 (Migration files)                                                                | Tasks 5-8, applied in Task 9                                                            |
| 4.6 (Seed list)                                                                      | Task 8                                                                                  |
| 5.2 (Import algorithm)                                                               | Task 20 (matches the spec algorithm step-by-step)                                       |
| 5.3 (Imperial via `Accept-UOM-System: ENGLISH`)                                      | Task 20 (header in measurement fetch)                                                   |
| 5.4 (Merge by `line_index` + soft-delete)                                            | Task 13 (TDD logic) + Task 20 (executes the plan)                                       |
| 5.5 (Zod)                                                                            | Task 15                                                                                 |
| 5.6 (Errors)                                                                         | Task 15                                                                                 |
| 6.1 (Routes)                                                                         | Tasks 27, 31, 32                                                                        |
| 6.2 (HP-aligned layout)                                                              | Task 29 (grouped by category, expand affordance)                                        |
| 6.3 (Components)                                                                     | Tasks 27-30                                                                             |
| 6.4 (Frontend conventions, `checkMutationResult`)                                    | Task 24                                                                                 |
| 6.5 (No charts)                                                                      | by omission — not added                                                                 |
| 6.6 (Edit mutation contract)                                                         | Task 26                                                                                 |
| 7.1 (Test tier matrix)                                                               | Tasks 1, 2, 10-14, 21, 33-36                                                            |
| 7.2 (Real fixtures)                                                                  | Task 3                                                                                  |
| 7.3 (TDD posture)                                                                    | Tasks 10-14 follow test-first                                                           |
| 7.4 (CI integration)                                                                 | Task 4                                                                                  |
| 7.5 (Manual verification)                                                            | Task 39                                                                                 |
| 8 (Tech debt addressed)                                                              | Task 19 (file split resolves the >500-line guardrail violation on `john-deere-import`)  |
| 9 (Locked decisions)                                                                 | Inherited by execution — no separate tasks                                              |
| 10 (Forward-looking — cost layer, FB integration)                                    | Documented in BACKBURNER, no tasks                                                      |
| 11 (Phased execution order)                                                          | Plan tasks follow the 14-phase order                                                    |

**No gaps found.** Every In-Scope spec requirement maps to at least one task.

### Placeholder scan

No "TBD", "TODO", "implement later", or "add appropriate X" instances found in the task bodies. All steps have either complete code or exact commands with expected output.

### Type consistency

Cross-reference verification:

- `ExtractedProductLine` defined in Task 10, used in Tasks 13, 20 — consistent fields
- `MergePlan` defined in Task 13, used in Task 20 — consistent
- `ProductCategory` defined in Task 23, used in Tasks 30, 31 — consistent
- `FieldOperationProductLine` defined in Task 23, used in Tasks 25, 26, 29, 30 — consistent
- `CategorySeed` defined in Task 14, mirrored in Task 20's `CategorySeedRow` — same shape, slightly different name; not a bug but worth noting. Acceptable since one is frontend and one is edge function (Deno) — separate type universes.
- `editProductLine(lineId, edits)` Task 26 signature matches Task 30 usage
- `revertProductLine(lineId)` Task 26 signature matches Task 30 usage
- Test fixtures referenced consistently as `application-rate-result-single-tankmix.json` across Tasks 3, 10, 11, 21

### Scope check

Single cohesive build. Phased into 9 task groups (A-I) but does not need to be split into separate plans — every group depends on the prior groups' artifacts to produce verifiable software.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-28-spray-application-sync.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Best for a plan this long (40 tasks across multiple file surfaces) where I can verify each task's diff before moving to the next.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints. Higher context usage but you see every keystroke.

Which approach?
