# Tech Debt

> Known debt to revisit. Things that work but aren't ideal.
> Updated when new debt is identified, items are resolved, or priorities shift.
> Resolved items move to a Resolved section at the bottom (don't delete — paper trail matters).

> **Source of truth for many of these is the `SCAN:AUTO` block in `CLAUDE.md`** (managed by Watch Tower's `weekly-security-scan`). This file holds engineering debt + the rationale for _why_ items aren't fixed yet. Don't paraphrase the scan output here — link to it.

## Active

### Per-row write-sync triggers fire during the bulk JD import (perf, not correctness)

- **Where:** `fdh.fn_sync_*_from_legacy` / `farm_overlay.fn_sync_*_from_legacy` AFTER triggers on the
  `operations_center` tables, hit on every upsert during `john-deere-import` (~7k row writes per full import).
- **What:** The triggers decompose each legacy row into `fdh` + `farm_overlay` one row at a time, so a full
  re-import does the sync work ~7k times inline. This is a chunk of the import's ~3 min server-side runtime.
- **Why it's only perf now:** As of 2026-06-23 the import is async (client polls `import_runs`), so the long
  runtime is invisible to the user and no longer 504s. Correctness is fine — triggers keep `fdh` current.
- **Cost to fix:** medium — pause the per-row triggers during a bulk import (control flag the triggers check)
  + one set-based `fdh` re-sync afterward (needs upsert semantics, riskier on financial data than the async
  fix, which is why it was deferred). **Trigger:** if import runtime becomes a problem, or data growth pushes
  the import toward the edge function **wall-clock** limit (not the gateway — async already handles that).

### Track 2 (fdh migration) — transitional debt carried until cutover completes

- **Where:** `docs/migration/01-07`, `operations_center.fdh_*` views, `farm_overlay.*`, the write-sync triggers.
- **Items:**
  - **operations_center not retired.** Legacy is still the write backbone; reverse views expose the **legacy id** so the app's write-by-id round-trips. Can't retire until writes move to fdh-native (R5). Triggers keep fdh current meanwhile.
  - **Migration SQL lives in `docs/migration/`, applied via MCP `execute_sql` — NOT in `supabase/migrations/`.** Deviates from the project's migration discipline; not reproducible via `supabase db push`. Reconcile into real migrations before/at cutover.
  - **Multi-org product modeling gap.** `fdh.product` is org-agnostic (grower_id null); `fdh_products` / `fdh_product_prices` scope the legacy product join by `jd_product_id` only — correct for one org, would multiply across a second org. Needs an org key on `fdh.product` for true multi-org.
  - **Price-owner grower resolved by name `'Precision Farms'`** in `fn_sync_product_price_from_legacy` (single-operator convention; brittle if renamed — fails loud by design).
  - **Grass ops divergence.** 4 GRASSLAND/HARD_FESCUE ops are excluded from fdh but the app still shows them (`hidden_crop_names` empty, only RYE globally excluded). Add GRASSLAND/HARD_FESCUE_GRASS to `lib/crop-filter.ts` GLOBALLY_EXCLUDED_CROPS so current == post-cutover before flipping reads.
- **Cost to fix:** medium, spread across R4/R5. **Trigger:** the read-flip cutover, then operations_center retirement.

### Terrace detection runs offline; in-app detector is the superseded DEM approach

- **Where:** `lib/terrace-detect.ts` (in-app, machine-DEM ridge detect) vs the production pipeline in `~/Downloads/terrace-proto/` (1 m lidar → crest/channel centerlines).
- **What:** The good detection (lidar, validated against the drone ortho) is offline Python; the app's "Detect terraces" button still runs the DEM approach that plateaued at ~85%/fragmented. Home Place's lines got into the app via a one-off SQL import, not an in-app detect. Other fields can't be detected from the UI.
- **Why it's debt:** Every other field needs a manual offline run + import until the lidar pipeline is ported in-app (or a per-field detect edge function exists). Lidar tile already on disk, covers the whole farm.
- **Cost to fix:** medium — port the prune/pair pipeline to TS (or a server step), wire to a "Detect (lidar)" button that writes draft rows. Also: lidar is a **2018 snapshot** — terraces reworked since won't appear (RTK Gator `driven` source or drone DSM fills that).
- **Trigger:** when Galen wants terraces on a second field, or after he collects RTK Gator / DSM data.

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

### Seed test data + price rows in shared prod DB — 2026-06-10

All 11 seed rows deleted in one Codex-approved transaction (5 tables × `org_id='seed-org'` + the `dev@precisionfarms.test` connection row). Verified 0 seed rows remain; real data intact (71 fields, 1,686 ops). The dependent untracked spec `tests/e2e/applications-view.spec.ts` deleted with it. Covers both former seed-data items (Group G UI seed + pricing seed rows).

### `debug-spray-shape` edge function — 2026-06-10

Deployed function deleted from `nuxofsjzrgdauzriraze` (verified gone via functions list); local folder removed (commit 610f52b). Cleared two Watchtower P3 flags (cors wildcard + stale debug endpoint).

### Orphaned `area-unit-toggle.tsx` — 2026-06-10

Deleted (never imported; the area-unit preference shipped via Settings).

### `exhaustive-deps` warnings in reports components — 2026-06-10

Bigger than first scoped: the `hiddenCrops.join(",")` dep-array pattern existed in THREE files (`reports-yield-charts`, `reports-trends`, `reports-view`). All fixed by memoizing `hiddenCrops` on a join-key (same contents-based re-run semantics) + real array in deps; `reports-trends` crop-snap moved to functional setState so `selectedCrop` left its effect deps without refetch-on-pick. Zero `exhaustive-deps` warnings remain (3 informational `<img>`→`next/image` notices are the only lint output). Codex-reviewed, no findings.

### `john-deere-import/index.ts` over 500 lines — resolved by 2026-06-03

Split into a 135-line dispatcher + per-action modules (`actions/import-fields.ts`, `import-operations.ts`, `import-applications.ts`, etc.) + tested pure helpers during the spray-sync/pricing build, exactly as the entry prescribed. Largest action file is `import-applications.ts` at 406 lines. Confirmed by the 2026-06-10 repo audit.

### CORS wildcard on all Supabase Edge Functions — 2026-05-28

Resolved as part of spray-application sync build (Task 0.1). `_shared/cors.ts` now uses an explicit allowlist with `Vary: Origin`. Commits aa76cd5 + 7942c9d.

### Error response leakage in all Edge Functions — 2026-05-28

Resolved as part of spray-application sync build (Task 0.2). `_shared/generic-error.ts` added; all 4 functions' catch blocks retrofitted. Commit 9442f2a.

### No server-side route protection (middleware.ts) — 2026-05-28

Resolved as part of spray-application sync build (Task 0.3). `middleware.ts` added at project root using `@supabase/ssr`. Commits e1e149c + ae0df7e.

### Overly broad John Deere OAuth scopes — 2026-05-28 — **REVERSED 2026-06-03**

Resolved as part of spray-application sync build (Task 0.4). Scopes trimmed to `ag1 org1 work1 offline_access` in `lib/john-deere-client.ts`. Commit 31207ee.
**Reversal:** the trim broke the application/chemical import (JD 403s swallowed as "0 results") — application data requires `ag2`+`ag3`. Scopes deliberately restored to `ag1 ag2 ag3 org1 work1 offline_access` (`lib/john-deere-client.ts:314`) and Galen re-consented. The broader scopes are now intentional, not debt.
