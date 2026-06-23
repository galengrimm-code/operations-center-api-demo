# Session Handoff — 2026-06-22 (Track 2: migrate reads onto the `fdh` schema)

> **Ephemeral.** Rewritten end of session.

## What was done
Migrated the app's data layer from the flat `operations_center` tables onto the new normalized
**`fdh`** schema + **`farm_overlay`** edit layer, read through reverse adapter views, behind flags
(default OFF). All DB work is parity-proven byte-exact vs legacy and Codex-reviewed. SQL lives in
`docs/migration/01-07` + `OPS-PRODUCTS-CUTOVER-PLAN.md`.

- **Fields:** cut over — edge `get-stored-fields` reads `operations_center.fdh_fields`
  (`FDH_READ_FIELDS=true` live). Fixed a real bug: views must expose the **legacy id** so the
  app's write-by-id round-trips (the irrigation_start_year edit had been writing 0 rows post-cutover).
  Write-sync trigger `fdh.fn_sync_field_from_legacy` live + tested.
- **Ops/products DB layer:** overlay tables (`05`), reverse views `fdh_field_operations /
  fdh_field_operation_products / fdh_products / fdh_product_prices` (`06`, Codex-hardened),
  write-sync triggers (`07`, Codex-reviewed/fixed/tested). LIVE + additive — they silently keep
  fdh current on every legacy write; the app still reads legacy, so no behavior change yet.
- **Ops/products app layer (R2):** `lib/fdh-flags.ts` flag; all browser reads flag-gated to the
  fdh views; the two nested PostgREST embeds (`fetchApplications`, `fetchProductsRollup`) rewritten
  as query-each-view + client-join. Writes stay on legacy (write-by-id; triggers sync). Edge
  `get-stored-operations` gated on `FDH_READ_OPS`.

## Current state
- Verified: `npm run prebuild` green (lint + typecheck + 112 tests), prod build passes,
  data-equivalence identical to the penny (application `total_value` = $9,389,819.40 both paths).
  Galen confirmed Codex is happy.
- **CUTOVER LIVE IN PROD (2026-06-22).** Pushed to `main` (`e7086d5` code + `e637ada` docs), Vercel
  prod redeployed, and ALL read flags flipped ON: `FDH_READ_FIELDS` + `FDH_READ_OPS` (Supabase edge
  secrets) and `NEXT_PUBLIC_FDH_READ_OPS=true` (Vercel prod env, baked into the build). Verified in
  prod: browser reads hit `/rest/v1/fdh_field_operation_products` with NO localStorage override and
  zero console errors; data byte-exact ($9,389,819.40). Reads now served from fdh; writes still hit
  legacy and the triggers sync. **Revert:** unset the two edge secrets + the Vercel env (or
  `localStorage.setItem('fdh_read_ops','false')` per-browser) — instant.

## Open question
None — cutover is live.

## Migration hygiene — DONE (2026-06-22)
- fdh DDL now version-controlled in `supabase/migrations/20260622120{0..4}00_fdh_*` (idempotent) and
  REGISTERED applied in `supabase_migrations.schema_migrations` (additive; fdh core was already
  `20260620203501_fdh_v7_schema`). One-time data backfills stay in `docs/migration/`.
- `lib/crop-filter.ts` GLOBALLY_EXCLUDED_CROPS now includes GRASSLAND + HARD_FESCUE_GRASS.
- Stale rule docs updated: `.claude/rules/architecture.md` (Track 2 section) + `database.md` (fdh read note).
- ⚠ `schema_migrations` is SHARED across Farm Data Hub / Landowner-Portal / Farm Budget — only ever ADD
  this app's rows. `supabase db push` from this repo shows the other apps' migrations as remote-only.

## Next steps (R5, later)
1. Watch for a day: re-import fields/ops once and confirm the write-sync triggers keep fdh current.
2. R5: retire `operations_center` once stable (move writes to fdh-native, drop triggers + legacy tables);
   eventually JD ingestion → YieldStack.

## How to resume / caveats
- Reverse views expose **legacy ids** (INNER joins to operations_center.*) so writes-by-id
  round-trip during transition; flip to fdh ids when legacy is retired.
- Multi-org product modeling is a known gap (`fdh.product` is org-agnostic) — fine for single-org.
- Price-owner grower resolved by name 'Precision Farms' (single-operator convention).
- Memory: `~/.claude/.../memory/farm-apps-integration-thesis.md` has the full migration status.
