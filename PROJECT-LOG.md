# Project Log

> Append-only log of major decisions, milestones, research findings, and data sources.
> New entries go at the TOP. Don't edit old entries — add new ones to correct/supersede them.
> Used to preserve the _why_ behind decisions across many sessions over many months.
>
> **Format:** `## YYYY-MM-DD — Short title` (one ## heading per entry)
> **Rules:**
>
> - Never delete entries. Mark things as superseded instead: `> SUPERSEDED YYYY-MM-DD: see entry below`
> - Keep entries scoped to decisions/research/milestones — not day-to-day task progress (that goes in SESSION-HANDOFF.md)
> - Include file paths, data locations, and reasoning so future sessions can verify
> - Date format is always absolute (YYYY-MM-DD), never relative ("yesterday", "last week")

---

## 2026-06-23 — Import made async to survive the 150s edge gateway timeout

**Milestone — import architecture.** A full John Deere re-import (`john-deere-import` → fields +
operations + applications, hundreds of JD API calls) runs past Supabase's ~150s edge **gateway**
timeout, so the browser 504s even though the function finishes server-side. A real re-import surfaced
it; a HAR showed both `import-fields` and `import-operations` dying at exactly ~150s. Data was never
lost — the function completes and the write-sync triggers kept `fdh` current — the 504 was a UX defect
on a working import.

**Decision — async + poll, NOT faster import.** Chose to make the import asynchronous rather than chase
the import under 150s. Reasons: (1) the JD-call volume alone is near/over 150s, so trimming the trigger
overhead might not have been enough; (2) async is robust regardless of import duration / data growth;
(3) it keeps the proven write-sync triggers untouched (lower risk on financial data than a new bulk
re-sync path). Mirrors the existing `pollForShapefileUrl` pattern already in the codebase.

**Shape:**
- `operations_center.import_runs` (migration `20260623134441_import_runs_status.sql`) records each run:
  running / done / error + a small result summary. RLS: select own rows; service-role writes only.
- Edge wraps `import-fields` / `import-operations` to record the run under a **client-minted `runId`**;
  back-compat mints server-side if absent (older client keeps working, gets the legacy direct response).
- Client (`lib/john-deere-client.ts`) mints the UUID, fires the POST, and on a 504 / dropped connection
  polls that exact `import_runs` row. Fast path (small orgs under 150s) still returns directly.

**Codex review (clean after fixes):** poll keyed by exact run id (no cross-tab/cross-org cross-talk, no
`started_at` ms-skew), fail-fast if no row appears in ~30s (offline), and status bookkeeping wrapped so
it can never throw and fail a working import. Branch `fix-import-504-async-poll`, commit `a2cfd9f`,
merged to `main` 2026-06-23.

**Deferred (not debt-free):** the per-row write-sync trigger overhead on the bulk import is untouched —
the import is still ~3 min server-side, now invisible behind the poll. Trimming it is optional perf
(TECH-DEBT), not a correctness gap, because async kills the 504 regardless.

## 2026-06-22 — Track 2: data layer migrated onto the `fdh` schema (built, not yet cut over)

**Milestone — schema migration.** Moved Farm Data Hub off the flat `operations_center` tables onto the
normalized **`fdh`** schema (the YieldStack v7 layout, single-operator/multi-grower) + a **`farm_overlay`**
edit layer, read through reverse adapter views, all behind flags (default OFF). Kept in the SAME Supabase
project (`nuxofsjzrgdauzriraze`) in new schemas to hold cost down. SQL: `docs/migration/01-07` +
`OPS-PRODUCTS-CUTOVER-PLAN.md`. Commit `e7086d5` on branch `track2-ops-products-cutover` (not on `main`).

**Why.** Foundation for field-level P&L across the farm apps and the eventual move of JD ingestion to
YieldStack; `fdh` core stays YieldStack-aligned (agronomic truth), the FDH-only cost/edit layer lives in
`farm_overlay` and never flows to YieldStack (Galen's call).

**Architecture decided this session:**
- Reverse views expose the **legacy id** (INNER joins back to operations_center.*) so the app's write-by-id
  round-trips during transition; write-sync triggers propagate legacy writes into fdh+overlay. Flips to fdh
  ids only when legacy is retired. (Caught + fixed a real bug where the fields view exposed the fdh id and
  the irrigation_start_year edit was silently writing 0 rows.)
- App still **writes** legacy (unchanged); triggers keep fdh current. App **reads** flip to fdh views behind
  flags. Nested PostgREST embeds can't cross views, so `fetchApplications`/`fetchProductsRollup` were
  rewritten as query-each-view + client-join.

**Verification:** every layer parity-proven byte-exact vs legacy; Codex-reviewed (found + fixed real issues:
multi-org join multiplication, null-id rows, soft-delete divergence, unknown-op-type hard-fail, subtype
scoping); `prebuild` green (lint + typecheck + 112 tests); prod build passes; application `total_value`
identical to the penny ($9,389,819.40) legacy vs fdh.

**Status:** all read flags OFF in prod → nothing cut over yet. Remaining = get the commit on `main`, in-app
cost-number smoke, then enable `FDH_READ_OPS` + `NEXT_PUBLIC_FDH_READ_OPS`. See SESSION-HANDOFF.md.

## 2026-06-12 — Terraces feature shipped (lidar detection); cost-before-revenue sequencing

**Milestone — Terraces:** Shipped the `/terraces` feature (commit `ae7ff7e`): `operations_center.terraces` table (RLS, crest/channel/waterway grouped by `terrace_no`, draft/locked status, source tracking), Home Place's 35 detected lines imported, and a Mapbox + mapbox-gl-draw edit/lock UI. Detection re-runs only ever touch `draft` rows; `locked` lines are permanent field truth (read-only static layer). Galen verified live.

**Research-driven pivot to lidar (the breakthrough):** Multi-pass RTK machine-grid terrace detection plateaued (~85%, fragmented). Deep-research (`docs/research/terrace-line-extraction-research-2026-06-11.md`) found the cause: a 3–4 m machine grid is **below terrace feature scale** (terraces are 2–5 px wide there vs 9–18 px in 1 m lidar). Free USGS 1 m KS QL2 lidar (tile `KS_1m_x27y443`) resolves them cleanly — Iowa BMP project precedent confirms. Detection pipeline (detrend → crest/channel by residual sign → graph spur-prune → crest-channel pairing) lives offline in `~/Downloads/terrace-proto/`; **not yet ported in-app** (TECH-DEBT). Dai et al. 2019 independently validated the contour-directional architecture.

**Sequencing decision — cost before revenue:** Galen pivoted from terraces back to the Harvest-Profit-replacement (ROADMAP Pillar 1) and chose to **complete the COST side before adding revenue/profit**. Cost-completion gaps (value order): seed cost (planting carries zero cost today — biggest hole), then a flexible other-costs bucket (land/rent + drying/hauling/insurance/equipment — a cost feature needing no revenue), then surfacing cost in Reports. Banked for when revenue comes: land + flexible bucket; field-level P&L first (HP parity), zone-profit later. Why logged: orders the next several builds.

**Ops learning:** Supabase CLI edge-function deploy works on this machine via `functions deploy <fn> --no-verify-jwt --use-api` (server-side bundling sidesteps the local-bundler `uv_spawn` block) — supersedes the earlier "CLI fully broken, use MCP" note.

---

## 2026-06-11 — Project north star set: an agronomic engine (ROADMAP.md created)

**Decision:** Galen articulated the long-term destination of Farm Data Hub —
it is becoming **his agronomic engine**, organized around two pillars:

1. **Profit per acre** — as-applied inputs + yield + grain price → exact margin
   by acre / field / zone. (Cost layer shipped 2026-06; profit layer is the
   highest-value next build; sub-acre profit-by-zone is the differentiator over
   Harvest Profit's field-average.)
2. **Agronomic testing / fine-tuning engine** — treat the farm as a permanent
   replicated trial; vary inputs (N rate, variety, seeding rate) across known
   conditions (soil type, landscape position) and learn each zone's real
   optimum. This is also the mechanism that *generates* the agronomic
   calibration the outside research (terrain-VR landscape, same day) said can't
   be bought — nobody's terrain→rate coefficient transfers between fields.

The terrain/elevation work (elevation model, lidar, terraces, slope/TPI/TWI/flow
derivatives) is reframed in the roadmap as the **spatial substrate both pillars
run on**, not a side feature. Full phased sequence and build-vs-buy line in
**`ROADMAP.md`** (new this session). Research backing in
`docs/research/terrain-vr-modeling-research-2026-06-11.md`.

**Why logged:** this is the framing decision that orders every future build —
worth preserving the _why_ so later sessions sequence against the two pillars
rather than chasing features.

---

## 2026-06-03 — Input-pricing cost layer shipped; NH3 nutrient-vs-product cost model; JD scope requirement

**Milestone:** Built and shipped the full **input-pricing cost layer** — the Harvest-Profit-style per-acre input cost feature. Year-keyed prices set on the Products page flow into `$/ac` on every application line + a per-field cost summary (Actual vs Spread basis). This is the core of the plan to retire the $1,600/yr Harvest Profit subscription. Spec at `docs/superpowers/specs/2026-06-01-product-pricing-cost-layer-design.md`, plan at `docs/superpowers/plans/2026-06-02-product-pricing-cost-layer.md`. Built via subagent-driven TDD (11 tasks), Codex-reviewed twice.

**Key data-model decisions:**

- **Year-keyed prices, not effective-date.** `operations_center.product_prices (user_id, org_id, product_id, year, price_per_unit, price_unit)`, unique on `(user_id, org_id, product_id, year)`. Supersedes the `product_price_events(effective_date,...)` sketch in the spray-sync spec — year granularity matches how Galen prices (and the `crop_season` on operations) and is simpler. An application picks its price by `(product_id, crop_season year)`.
- **Cost derives from `total_value`/`total_unit` (bare unit like `lb`/`floz`/`gal`), NEVER `rate_unit`** (which is a JD token like `lb1ac-1`). `total_value` is JD-authoritative. Verified against real rows. Area always normalized to acres via `acresFrom` (ha→ac ×2.47105) before any `$/ac` division — a raw hectare value would undercount ~2.47×.
- **Unit conversion** (`lib/unit-convert.ts`): weight (ozm/lb/ton) + volume (floz/pt/qt/gal) fixed factors; cross-family (priced $/ton, applied in gal) via per-product `density_lbs_per_gal` (lbs/gal). Returns null (renders "—") when not convertible — never a fabricated $0.00.

**NH3 nutrient-content model (`products.nutrient_content_pct`):** John Deere records anhydrous ammonia application as **pounds of actual N**, but it's purchased/priced by the **ton of total product**, and NH3 is **82% N**. So a plain lb→ton conversion undercounts the cost by ~18% (gives tons-of-N, not tons-of-product). The fix: a per-product "nutrient content %" (default 100% = applied is the product). Cost scales `lb N ÷ (pct/100) → lb product → tons → × $/ton`. This generalizes to any input recorded by nutrient but bought by product. Most fertilizers (potash, gypsum, MAP) are recorded _as product_ and need no factor — just lb→ton. **NH3 is the main case.** Real data: NH3 in org 600550 is 74 lines, applied in `lb`, avg 14,642 lb/op.

**Operational finding — JD OAuth scopes:** Spray/application/chemical/tank-mix data requires **`ag2`+`ag3`** scopes; `ag1` alone only exposes harvest/seeding. The 2026-05-28 security trim (to `ag1 org1 work1`) silently broke the spray import — JD 403s the application calls, swallowed as "0 results." Restored to `ag1 ag2 ag3 org1 work1 offline_access` (`lib/john-deere-client.ts`). Scopes bake into the OAuth grant at consent — a token refresh can't add them; the user must reconnect. **Rule:** don't trim `ag2`/`ag3` without breaking the applications feature.

**Real spray data is now imported:** 1,013 application ops across 69 fields (org 600550). The all-fields import must be **chunked per-field** — a single all-fields call 504s on real data (~600 sequential JD calls).

---

## 2026-05-29 — Auth must use cookie sessions (`createBrowserClient`), not localStorage; middleware regression

**Finding/decision:** The `route-protection-gap` fix from 2026-05-28 (Task 0.3) shipped a **live regression**. `middleware.ts` validates the session server-side via `@supabase/ssr` `createServerClient`, which reads **cookies**. But `lib/supabase.ts` used `@supabase/supabase-js` `createClient`, which stores the session in **localStorage** — invisible to the server. Net effect: after login, every authenticated user was 307'd off all `(app)/*` routes back to `/login?redirect=…`. It shipped because Task 0.3's verification only tested the logged-out path (`curl /map → 307`), never an authenticated user reaching a protected route.

**Resolution:** `lib/supabase.ts` switched to `createBrowserClient` (`@supabase/ssr`), which persists the session in cookies that both the browser client and the SSR middleware read. Preserved the `db: { schema: "operations_center" }` pin and `<Database>` typing. Verified with a production build + a Playwright login that reaches `/map` and a full e2e suite. Commit `0562dd0`.

**Rule going forward:** Any Next.js app in this portfolio that uses `@supabase/ssr` middleware MUST use `createBrowserClient` (cookie sessions) on the client — never plain `createClient` (localStorage). The two are incompatible; localStorage sessions are invisible to server middleware. Verify auth fixes by confirming an _authenticated_ user reaches a protected route, not just that an anonymous one is redirected.

**Also this session (build progress, not decisions):** Groups F + G of the spray-sync build landed (data layer + full Applications UI), browser-verified against seeded test data. Two more plan bugs caught by verification: a `field:fields(name)` PostgREST embed with no backing FK (would throw on first real data — `4d1f599`), and a loading-state pattern that collapsed expanded rows on every refetch (`fe05754`). Build now 39/45; remaining tasks all require a real JD import (Task 39 cluster).

---

## 2026-05-28 — Watch Tower v6.7 security audit; folded 4 fixes into spray-sync build

**Decision:** Audited the current Watch Tower scan prompt (v6.7 in `Public Watchtower/prompts/security-scan-prompt.md`) against this project's SCAN:AUTO block (last scan v6.4, 2026-05-06). Folded 4 actionable findings into the spray-application-sync implementation plan as a new Group 0 (Security Hardening) that runs BEFORE feature work.

**Findings addressed by Group 0:**

1. `cors-open` (P1) — `_shared/cors.ts` restricted to allowlist (`operations-center-api-demo.vercel.app` + `localhost:3000`), with `Vary: Origin` for cache correctness
2. `error-response-leakage` (P2) — `_shared/generic-error.ts` added; all 4 existing functions' catch blocks retrofitted to return `{error: "request_failed", code: "<FN>_<STATUS>"}`
3. `route-protection-gap` (P3) — `middleware.ts` added using `@supabase/ssr`; `(app)/*` routes now 307 to `/login` server-side before any page HTML loads
4. `oauth-broad-scopes` (P3) — `lib/john-deere-client.ts:288` trimmed from `ag1 ag2 ag3 org1 org2 work1 work2 offline_access` to `ag1 org1 work1 offline_access`

**v6.7 additions vs v6.4 reviewed but not applicable / deferred:**

- `cors-origin-reflection` (P1 new) — avoided by allowlist approach
- `public-sensitive-endpoint` (P1 new) — Vercel-handled, no app code action
- DNS audits (DMARC/SPF/CAA) — domain config, BACKBURNER
- File-over-500 threshold changed to 1500 for JSX/TSX — relaxes existing 4 flagged JSX files; only TS files >500 still flag

**Why folded vs separate:** all 4 fixes touch surfaces this build already modifies (edge functions, shared modules, OAuth string). Doing them now means new feature code inherits the clean baseline; doing them later would require revisiting the same files twice.

**Out of scope (explicit, separate work):**

- `no-rate-limiting` (P3) — needs Upstash/Redis infrastructure decision
- `npm-cve-residual` (P4) — Next 16 major migration sprint
- Other `file-over-500` files (irrigation-analysis, progress page, reports views) — orthogonal refactors
- `no-input-validation` on legacy 4 functions — new endpoint gets Zod (plan Tasks 15, 20); legacy retrofit is follow-on

**Plan file:** `docs/superpowers/plans/2026-05-28-spray-application-sync.md` — Group 0 inserted before Group A (Tasks 0.1-0.5).

---

## 2026-05-28 — Adopted project-memory template; kicked off spray-products sync design

**Decision:** Adopt the `~/.claude-sync/templates/project-memory/` skeleton in this repo so multi-session work (starting with the spray-products sync) has a durable journal. The hub files (`CLAUDE.md`, `AGENTS.md`, `README.md`) and existing rule files in `.claude/rules/` were already substantial and stayed put — only the journal files (`SESSION-HANDOFF.md`, `PROJECT-LOG.md`, `TECH-DEBT.md`, `BACKBURNER.md`, `CHANGELOG.md`) and one new rule file (`data-safety.md`) were added.

**Why:** The next build (spray applications + product-level data tied to fields) is the first piece of work in this repo that's likely to span multiple sessions and generate decisions worth preserving (schema choices, JD API quirks, UI surface trade-offs). Without the journal, the rationale evaporates the moment the conversation ends.

**Spray-sync scope (initial framing — pending design):**

- Pull `APPLICATION` field operations from JD Ops Center (operation type already partly scaffolded in `supabase/functions/john-deere-import/index.ts:243-248` via `MEASUREMENT_TYPE_MAP`, but excluded from the `operationTypes` loop at lines 387 and 532)
- Capture the **products** applied per operation (tank mix), keyed to fields — the current `field_operations` table has no products column and isn't shaped to hold a list
- Surface products in UI tied to fields, so we can answer "what's been sprayed on field X this season" and "where did product Y get applied"
- Codex consult on the schema + sync strategy before any code lands

**Open questions deferred to brainstorm:**

- Whether JD's `fieldOperations/{id}/measurementTypes/ApplicationRateResult` actually returns the products array, or whether products live behind a separate endpoint
- Whether tillage (`TillageDepthResult`, also in the map but excluded from the loop) should be picked up in the same build
- Schema normalization: one row per (operation, product) in a new table, vs. JSONB column on `field_operations` — leaning normalized for analytics

**Files involved:**

- New: `SESSION-HANDOFF.md`, `PROJECT-LOG.md`, `TECH-DEBT.md`, `BACKBURNER.md`, `CHANGELOG.md`, `.claude/rules/data-safety.md`
- Read-only context: `supabase/functions/john-deere-import/index.ts:243-453` (operation import pipeline)
