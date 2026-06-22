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
- **Pushed to `main`** (Galen authorized 2026-06-22) → Vercel prod deploy. Commits `e7086d5` (code) +
  `e637ada` (docs). All read flags **OFF**, so the deploy is behavior-neutral — nothing cut over yet.

## Open question
Resolved: pushed to main. Now do the in-app smoke + flip the flags (next steps below).

## Next steps (immediate — R4 → R5)
1. Get `e7086d5` onto `main` per Galen's choice → Vercel deploy (flag still off).
2. In-app smoke via `localStorage.setItem('fdh_read_ops','true')` on prod: confirm Applications /
   Reports / Products cost numbers render identical to flag-off.
3. Add `GRASSLAND` + `HARD_FESCUE_GRASS` to `lib/crop-filter.ts` GLOBALLY_EXCLUDED_CROPS (4 grass
   ops are excluded from fdh but the app still shows them today; `hidden_crop_names` is empty).
4. Enable together: `FDH_READ_OPS` (edge secret) + `NEXT_PUBLIC_FDH_READ_OPS` (Vercel env, needs
   redeploy) = the real cutover. Revert = flags off.
5. R5 (later): retire `operations_center` once stable; eventually JD ingestion → YieldStack.

## How to resume / caveats
- Reverse views expose **legacy ids** (INNER joins to operations_center.*) so writes-by-id
  round-trip during transition; flip to fdh ids when legacy is retired.
- Multi-org product modeling is a known gap (`fdh.product` is org-agnostic) — fine for single-org.
- Price-owner grower resolved by name 'Precision Farms' (single-operator convention).
- Memory: `~/.claude/.../memory/farm-apps-integration-thesis.md` has the full migration status.
