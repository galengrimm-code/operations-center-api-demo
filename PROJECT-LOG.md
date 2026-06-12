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
