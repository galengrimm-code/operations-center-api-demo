# Tech Debt

> Known debt to revisit. Things that work but aren't ideal.
> Updated when new debt is identified, items are resolved, or priorities shift.
> Resolved items move to a Resolved section at the bottom (don't delete — paper trail matters).

> **Source of truth for many of these is the `SCAN:AUTO` block in `CLAUDE.md`** (managed by Watch Tower's `weekly-security-scan`). This file holds engineering debt + the rationale for *why* items aren't fixed yet. Don't paraphrase the scan output here — link to it.

## Active

### Mixed-unit products show "—" for cost/total (no per-product unit handling)
- **Where:** Products + Applications cost display. Affects products applied in **different unit families across operations** — confirmed in org 600550: `24D` (floz + ozm), `Absorb 100` (floz + ozm + pt + qt), `Accent Q` (floz + gal + ozm).
- **What:** A single product `price_unit` can't value lines in two families (floz is volume, ozm is weight; no density bridge for a generic chemical). Those lines fall to `null` → render "—". `appliedInPriceUnit`/`lineTotalCost` correctly return null rather than a wrong number.
- **Why it's debt:** A handful of products won't price cleanly until handled per-line/per-unit.
- **Cost to fix:** medium — likely a per-line unit override, or splitting the product, or a density bridge. Decide when it bites real data.
- **Trigger:** Galen's real-data pricing pass — if a real line unexpectedly shows "—".

### Unit converter doesn't know bare `oz` (only `ozm` / `floz`)
- **Where:** `lib/unit-convert.ts` weight set is `ozm/lb/ton`, volume `floz/pt/qt/gal`.
- **What:** Real JD data uses `ozm` (dry) and `floz` (fluid) — both handled. But the synthetic seed data uses bare `oz` (Liberty 280 SL), which the converter doesn't recognize → "—". Real data has no bare `oz`, so production is fine.
- **Why it's debt:** Only a gap if a real import ever brings bare `oz`. Low risk.
- **Cost to fix:** trivial — add an `oz` alias (but must decide dry vs fluid; ambiguous, which is why it's not aliased).
- **Trigger:** a real line shows "—" and its unit is bare `oz`.

### Seed test price rows in shared prod DB
- **Where:** `operations_center.product_prices` rows for `org_id='seed-org'` (AMS $400/ton, UAN $3.50/gal, year 2025), shared project `nuxofsjzrgdauzriraze`. Added 2026-06-03 to prove the pricing flow end-to-end.
- **What:** Test pricing data in prod (scoped to the seed test user `178fdca1-…`, separate from real org 600550).
- **Why it's debt:** Fake data in prod. Harmless (seed-org only), but tidy-up worthy with the rest of the seed data.
- **Cost to fix:** trivial — `DELETE FROM operations_center.product_prices WHERE org_id='seed-org';`
- **Trigger:** general seed-data cleanup (also see the `org_id='seed-org'` rows item below).

### Export is Products-rollup only
- **Where:** `lib/products-export.ts` (Excel + PDF). Scoped to the Products rollup by deliberate v1 choice.
- **What:** No Applications-level export (per-field application detail, $/ac) and no field-cost-summary export.
- **Why it's debt:** Galen will likely want a per-field / landlord-operator report.
- **Cost to fix:** small-medium — reuse the same exceljs/jspdf path over the applications + field-summary data.
- **Trigger:** when Galen needs to share/print application or field cost detail.

### Applications/Products read path does full-table client-side processing
- **Where:** `lib/applications-client.ts` — `fetchApplications` filters `productId`/`category` in JS (not SQL); `fetchProductsRollup` pulls all product-line rows and aggregates in the browser. Every applications filter change refetches the full nested payload.
- **What:** O(all of the user's rows) shipped to the browser per load. Deliberate v1 choice (the plan explicitly chose client-side aggregation).
- **Why it's debt:** fine at farm scale (dozens–hundreds of ops); slow at thousands of ops/lines.
- **Cost to fix:** medium — move the rollup to a Supabase RPC / SQL aggregate; push `productId`/`category` filters into the query (join through `field_operation_products`/`products`).
- **Trigger:** when an org's spray history grows large, or when adding cross-season analytics. Flagged by Codex adversarial review 2026-05-29 (P2).

### Spray-sync test data seeded into shared prod DB (delete before Task 39)
- **Where:** `operations_center` rows with `org_id='seed-org'` (1 field, 3 products, 1 application, 3 product lines) + a placeholder `john_deere_connections` row for `dev@precisionfarms.test` (UID `178fdca1-ea1c-4995-bfee-110aaaee469b`), shared project `nuxofsjzrgdauzriraze`.
- **What:** Seeded 2026-05-29 to browser-verify the Applications UI (Group G) against real data on a fresh test account.
- **Why it's debt:** Fake data in the production DB. If a real JD import (Task 39) runs for this user before cleanup, fake + real mix.
- **Cost to fix:** trivial — `DELETE FROM operations_center.<table> WHERE org_id='seed-org';` across the 4 tables + delete the placeholder connection row.
- **Trigger:** **before Task 39** (real import). First thing next session.

### `debug-spray-shape` edge function still deployed (Task 38 deferred)
- **Where:** Supabase project `nuxofsjzrgdauzriraze`, function `debug-spray-shape` (v1); local source at `supabase/functions/debug-spray-shape/`.
- **What:** Phase 0c read-only diagnostic for inspecting JD application-rate response shapes. Job done (schema locked).
- **Why it's debt:** Extra deployed surface area. Deletion deferred 2026-05-29 (deleting a live fn on shared prod wants explicit authorization).
- **Cost to fix:** trivial — dashboard delete or `npx supabase functions delete debug-spray-shape --project-ref nuxofsjzrgdauzriraze`, then remove local folder + commit.
- **Trigger:** Task 38 / next session cleanup.

### `john-deere-import/index.ts` over 500 lines (689 and growing)
- **Where:** `supabase/functions/john-deere-import/index.ts`
- **What:** 689 lines, multiple actions (`import-fields`, `import-operations`, `import-field-operations`, `debug-field-boundaries`, `debug-field-operations`) and helper functions in one file. Up from 658 at the last scan.
- **Why it's debt:** Single-file edge functions get hard to reason about — the existing CLAUDE.md guardrail says **"do not add to this file — split into per-action modules before adding features."**
- **Cost to fix:** medium — extract per-action handlers (`actions/import-fields.ts`, `actions/import-operations.ts`, etc.) + shared helpers; rewire the dispatch.
- **Risk of not fixing:** medium (debt accelerates as we add spray products on top).
- **Trigger:** **already triggered** — the spray-sync build will add a new action and several helpers, so the split should happen *as part of* that build rather than before/after.

### `irrigation-analysis.tsx` and `progress/page.tsx` over 500 lines
- **Where:** `components/dashboard/irrigation-analysis.tsx` (660), `app/(app)/progress/page.tsx` (639), `components/reports/reports-yield-charts.tsx` (533), `components/reports/reports-view.tsx` (530)
- **What:** Same pattern — single-file components that have crept past the 500-line guardrail.
- **Cost to fix:** medium each, independent.
- **Risk of not fixing:** low–medium (each one still reads OK in isolation, but compounding).
- **Trigger:** next time we add a feature inside one of them.

### No input validation on Edge Function request bodies
- **Where:** All 4 edge functions — `req.json()` parsed and used directly
- **What:** No Zod / schema validation
- **Cost to fix:** small per endpoint
- **Risk of not fixing:** medium — bad inputs can crash functions or be exploited for unexpected behavior
- **Trigger:** new endpoints in the spray-sync build should ship with Zod from day one (don't widen the gap)

### No rate limiting on Edge Functions
- **Where:** All 4 edge functions
- **What:** No rate limit. Most concerning: `john-deere-irrigation` `shapefile-status` triggers paid JD API calls per request.
- **Cost to fix:** medium — needs Upstash/Redis or DB-backed state (in-memory resets on Vercel cold start, per portfolio guardrails)
- **Risk of not fixing:** medium (cost exposure on paid JD endpoints; abuse vector if origin is opened up)
- **Trigger:** before any new endpoint that hits a paid JD API call (this includes spray-product import if JD bills it)

### Mutable function search_path in `operations_center` schema
- **Where:** Trigger functions in `operations_center` schema (incl. `fop_set_user_org_from_field_op`, `fop_set_updated_at`, plus pre-existing functions from earlier migrations)
- **What:** Functions don't have `SET search_path = ''` or explicit schema qualification, leaving them vulnerable to shadow-table attacks if `search_path` is manipulated for the executing session
- **Why it's debt:** Supabase security advisor flags `function_search_path_mutable` WARN. Fix is one-line per function (`SET search_path = ''`). Existing functions in the schema also lack this hardening — codebase has implicitly accepted the pattern, but Watch Tower / Supabase advisors will keep flagging.
- **Cost to fix:** small — sweep all `operations_center` functions in one cleanup migration, add the explicit search_path setting
- **Risk of not fixing:** low — trigger functions only take internal references (UUIDs); risk only materializes if service_role's `search_path` is attacker-controlled, which it isn't
- **Trigger:** next routine security cleanup pass, OR if Watch Tower elevates the severity

### Residual Next 13.5.x CVEs
- **Where:** `next@^13.5.11` + 4 high CVEs inside the bundled deps + 1 moderate
- **What:** `npm audit fix --force` would push to `next@16.2.5` (breaking major)
- **Cost to fix:** large — Next 16 migration including App Router behavior changes, possible RSC compatibility review
- **Risk of not fixing:** low–medium — CVEs are mostly DoS classes, not RCE; deployed surface adds layered protections
- **Trigger:** a deliberate Next 16 migration sprint, not a one-off

## Resolved

### CORS wildcard on all Supabase Edge Functions — 2026-05-28
Resolved as part of spray-application sync build (Task 0.1). `_shared/cors.ts` now uses an explicit allowlist with `Vary: Origin`. Commits aa76cd5 + 7942c9d.

### Error response leakage in all Edge Functions — 2026-05-28
Resolved as part of spray-application sync build (Task 0.2). `_shared/generic-error.ts` added; all 4 functions' catch blocks retrofitted. Commit 9442f2a.

### No server-side route protection (middleware.ts) — 2026-05-28
Resolved as part of spray-application sync build (Task 0.3). `middleware.ts` added at project root using `@supabase/ssr`. Commits e1e149c + ae0df7e.

### Overly broad John Deere OAuth scopes — 2026-05-28
Resolved as part of spray-application sync build (Task 0.4). Scopes trimmed to `ag1 org1 work1 offline_access` in `lib/john-deere-client.ts`. Commit 31207ee.
