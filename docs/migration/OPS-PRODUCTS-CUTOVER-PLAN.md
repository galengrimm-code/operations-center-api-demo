# Ops/Products cutover — remaining plan

Track 2 finished the **fields** entity end-to-end (read via `operations_center.fdh_fields`,
write-sync trigger `fdh.fn_sync_field_from_legacy`, both live + verified). This doc covers
closing out **operations + products**, which are bigger than fields because the app **edits**
them (the profit/acre cost surface) and the reads use **nested PostgREST embeds**.

## Architecture (decided 2026-06-16)
- **fdh core** = JD agronomic truth (operation, operation_product, product, product_concept).
  YieldStack-bound; syncs out later.
- **farm_overlay** = FDH-only cost/edit layer. **Never flows to YieldStack.** Holds the
  editable surface the app writes.

## DONE — foundation (safe, additive, PROVEN)
- `05_fdh_overlay_cost_layer.sql` applied: `farm_overlay.operation_edit` (1:1 fdh.operation),
  `farm_overlay.operation_product_edit` (1:1 fdh.operation_product — the cost-line edit surface,
  COST MATH USES `total_value`), `farm_overlay.product_meta` (1:1 fdh.product). RLS = operator
  allowlist; column types matched to legacy (double precision values, text `_variable` flags).
  Prices already in `farm_overlay.product_price`.
- Editable data migrated in: operation_edit 1682, operation_product_edit 4889 (= every fdh line),
  product_meta 173 (= every product).
- **Parity proven**: fdh core + overlay reconstructs legacy EXACTLY — operation_product 4889/4889
  on total_value/total_unit/is_carrier/category_override/area/rate; products 173/173 on
  category/default_unit/price_unit_default/is_carrier_default/source; operations 1682/1682 on
  application_name/crop_name_override/measurement_status/user_edited.

## REMAINING

### R1 — Reverse adapter views (SQL, safe, additive)
Build in `operations_center`, security_invoker, presenting the OLD flat shapes:
- `fdh_field_operations` — fdh.operation + operation_edit; **reverse-map** uom (bu_ac→`bu1ac-1`),
  crop (Corn+Amylose subtype→`CORN_EURO`, Corn→`CORN_WET`, Soybeans→`SOYBEANS`, Rye→`RYE`),
  season int→text, operation_date→start_date. Carry application_name/measurement_status/crop_name_override.
- `fdh_field_operation_products` — fdh.operation_product + operation_product_edit (COALESCE overlay
  over core); jd_originals out of `fdh.operation_product.jd_original` jsonb.
- `fdh_products` — fdh.product + product_concept + product_meta (+ density/nutrient from core).
- `fdh_product_prices` — farm_overlay.product_price (+ year/price_unit).
- **Parity-test each** vs legacy on the full shape (reverse-mapping bugs surface here). Codex-review.

### R2 — App data-access rewrite (the big one; frontend; behind a flag)
The reads use nested embeds PostgREST can't do across plain views:
`field_operations.select("..., product_lines:field_operation_products(..., product:products(*))")`
with `!inner` + `is("deleted_at", null)`. Files: `lib/applications-client.ts`, `lib/reports-data.ts`,
`lib/season-progress.ts`, `components/settings/hidden-crops-section.tsx`,
edge `john-deere-api` action `get-stored-operations`. Options:
- (a) query each view separately + join client-side (most explicit), or
- (b) declare PostgREST computed relationships on the views, or
- (c) assemble in an edge function.
Recommend (a) for the cost path (reports/applications) so the join logic is visible/testable.

### R3 — Write-sync (legacy→fdh+overlay), Codex-reviewed
App writes legacy ops/products tables (editProductLine, editProductCategory, editApplicationName,
upsertProductPrice, setProductDensity, setCategoryPriceUnit, copyPricesFromYear). Mirror the field
trigger: AFTER triggers on `field_operations` / `field_operation_products` / `products` /
`product_prices` that decompose into fdh core + farm_overlay (fail-open on data errors, re-raise
structural). OR rewrite the write fns to target fdh+overlay directly. Trigger path keeps app code
unchanged (matches fields).

### R4 — Flip reads behind flags + in-app financial verification
Flip get-stored-operations + the browser reads to the fdh views. **Verify every reports/applications/
products cost number is identical** (Chrome MCP / Playwright on the value path) before trusting.

### R5 — Retire operations_center (later)
Once all reads/writes are on fdh+overlay and stable. Eventually JD ingestion → YieldStack.

## Footgun status
- Fields: closed (read fdh + write-sync live).
- Ops/products: **no footgun today** — they read AND write legacy (consistent). The footgun would
  only appear if R1/R4 flip reads before R3 write-sync exists. Do R3 before/with R4.
