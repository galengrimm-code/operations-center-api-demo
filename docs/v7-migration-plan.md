# Farm Data Hub → YieldStack v7 — Migration Plan

**Status:** scoped, awaiting go · **Created:** 2026-06-16 · supersedes `fdh-cutover-prep.md`

Migrate Farm Data Hub from its current 9-table `operations_center` schema to the **YieldStack v7** schema (`../../YieldStack` handoff, `schema/schema_v7.sql`). The Data Hub becomes the **single-/few-grower deployment of v7** plus a thin Precision Farms cost+planning overlay. YieldStack later = the same schema, its own project, multi-client, with the SaaS tenancy seam added on top.

---

## Decision: same project, new schema, strangler migration

- **Same Supabase project** `nuxofsjzrgdauzriraze` (minimal projects, flat cost).
- **New schema `fdh`** built alongside the live `operations_center`. Old schema stays as rollback the entire migration.
- **Cross-schema migration** (`INSERT … SELECT` in one DB — no FDW/export).
- **Strangler cutover:** write new JD-ingestion + app reads against `fdh`, feature by feature; retire `operations_center` only when the app fully runs on v7.

**Tradeoff accepted:** PostGIS + a ~31-table agronomic schema now lives in the database that runs Farm Budget. Discipline that keeps it safe: every statement schema-qualified to `fdh.*`; confirm the project ref before each push; watch the compute tier if real dense GPS data lands big later.

**Multi-org is free, not built.** v7's `grower` level *is* the multi-org dimension. The migration creates `grower` rows from `fields.client_name` (Precision Farms, Grimm Bros). No org/membership/partnership/RLS machinery — that's the deferred YieldStack seam. Grimm Bros = one grower row, zero dead weight. Payoff: the "Saylors ×2" name collision resolves itself (two fields under two growers).

---

## v7 refinements for THIS deployment (small, additive — not changes to v7's intent)

1. **External source ids for idempotent JD-API ingestion.** v7 dedupes on `data_import.file_hash` (a *file* assumption). The Data Hub uses the JD *API*, so add `external_ref` (the JD id) + keep `source_type` on:
   - `field.external_ref` = jd_field_id, `operation.external_ref` = jd_operation_id, `product.external_ref` = jd_product_id.
   These are the upsert keys (re-import doesn't duplicate) **and** the migration bridge. (`product.external_cost_ref` stays separate — that's the bridge OUT to the cost overlay, not the JD source id.)
2. **Operation summary columns (Fork 2).** Data Hub yield is operation-summary-level, not dense points. Add to `operation`: `avg_yield_value/unit`, `avg_moisture`, `total_mass_value/unit`, `area_value/unit`. Summaries live here; when real dense GPS is ingested later it lands as `operation_point` rows — the two coexist. Don't fake points from summaries.
3. **Preserve user-edits** on `operation_product`: carry `is_user_edited`, `edited_at`, and the `*_jd_original` values (columns or a `jd_original jsonb`). These are irreplaceable hand corrections.
4. **Schema-review fixes** (from the `schema_v7.sql` review) folded into the deploy:
   - Validate the `acres` `GENERATED … (ST_Area(geom::geography))` columns on a **branch first** — hard `CREATE TABLE` failure if PostGIS marks them non-IMMUTABLE; fall back to a trigger if so.
   - Enforce denormalized `grower_id` integrity (composite FK or trigger) — it's the future RLS key.
   - `data_import.file_hash` → `UNIQUE (grower_id, file_hash)`.
   - Drop `SECURITY DEFINER` from `fn_audit_stamp` (or set `search_path`).
   - **RLS — DECIDED: keep it (baseline now, grower-keyed later).** The current Data Hub already runs RLS on all 9 tables (`user_id = auth.uid()`); FDH must not regress. Posture: `ENABLE ROW LEVEL SECURITY` on every FDH table + a baseline `FOR ALL TO authenticated USING (true)` policy (operator sees all; anon denied → closes the public-anon-key hole). Edge functions keep service_role (bypasses RLS) for JD ingestion. Forward-compatible: per-grower policies keyed on the already-denormalized `grower_id` are additive later (no backfill). **Setup step:** add `fdh` to the Data API exposed schemas + grant `authenticated`/`service_role` (required for a non-`public` schema; `operations_center` already does this). `operation_point_value` has no `grower_id` — fine under baseline `USING (true)`; the one table to handle when per-grower RLS lands.

---

## Data migration map (`operations_center` → `fdh`)

| Current | → v7 | Transform |
|---|---|---|
| `fields.client_name` | `grower` | `INSERT … SELECT DISTINCT client_name` |
| `fields.farm_name` | `farm` | distinct `(client, farm)` → FK grower |
| `fields` (name, jd_field_id) | `field` (+ `external_ref`=jd_field_id) | resolve grower/farm by name |
| `fields.boundary_geojson` (jsonb) | `field_boundary.geom` | `ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text),4326)`; `is_active=true`; acres recomputed |
| `fields.irrigated_boundary_geojson` | `irrigation_system` + `irrigation_coverage.geom` | one system per field w/ irrigated boundary → versioned coverage |
| `field_operations` | `operation` (+ `external_ref`=jd_operation_id) + create `field_crop_year` | type→`operation_type`; crop_season→season; crop_name→`crop`; variety→`crop_subtype` |
| `field_operations` summaries | `operation` summary cols (refinement 2) | avg_yield/moisture/total_mass/area |
| `field_operation_products` | `operation_product` (+ user-edit preservation, refinement 3) | total_value→total_amount, rate→avg_rate, area→area_covered; product via external_ref |
| `products` | `product_concept` + `product` (+ external_ref=jd_product_id) | name→concept; brand/density→product |
| `products.nutrient_content_pct` | `product_nutrient` (N, pct, basis) | one N row per product that has it |
| `products.density_lbs_per_gal` | `product.density` (+ density_uom = lb/gal) | |
| `product_prices` | **stays** — cost overlay, re-anchored to new `product` | v7 stores no $; this is Precision Farms' private cost layer |
| `field_seasons` | planning overlay, re-anchored (or fold manual overrides into `field_crop_year`) | intended_* = planning; planted_* = overrides |
| `irrigation_analysis_results` | **drop / regenerate** | derived cache; v7 re-derives from coverage geometry |
| `product_category_seeds` | keep (helper lookup) | |
| `john_deere_connections` | keep (JD OAuth, app infra) | later becomes per-grower in YieldStack |

**Migration script:** one idempotent SQL/script run top-down in FK order (grower → farm → field → field_boundary → crop/product catalog → operation/field_crop_year → operation_product → irrigation). Re-runnable (`ON CONFLICT … DO NOTHING` / upsert on `external_ref`). Build a `field_id` ↔ `jd_field_id` and `product_id` ↔ `jd_product_id` map as you go so the overlays re-anchor.

---

## The cost + planning overlay (stays with the Data Hub, not v7)

`product_prices` and `field_seasons` are Precision Farms' private financial/planning data — **not** part of v7 (which stores no dollars). They remain in the Data Hub, re-anchored to the new `fdh.product` / `fdh.field` identities (the same "anchor on a stable id" idea from the superseded prep doc, now pointing at v7 ids). When YieldStack productizes to multi-client, these overlays stay behind with Precision Farms — they don't go to the shared product. Decide their home schema: keep in `operations_center` (re-pointed) or a small `farm_overlay` schema. Lean: a dedicated overlay schema so `fdh` stays pure agronomic.

---

## The app + John Deere rewrite (the real effort)

The schema + migration script are fast. The sustained work is re-pointing the app:
- **JD ingestion edge functions** (`john-deere-import`, etc.) → write `fdh` tables (operation/channel/operation_product/field/product) via `db:{schema:'fdh'}`, idempotent on `external_ref`. Written *new* alongside the old — this is why the new schema helps the JD rewiring.
- **`cost-calc`** → read `operation_product` + `product` + `product_nutrient` instead of `field_operation_products` + `products`.
- **Reads** across ~83 components (fields list, operations, products, reports, irrigation analysis, map) → v7 shapes.
- **Verify each feature** with the app running + Playwright before retiring its old-schema path.

---

## Phasing

1. **Deploy schema** — `CREATE SCHEMA fdh;` install PostGIS (project-level; confirm first); `SET search_path = fdh, public;` apply `schema_v7.sql` + the refinements. **Validate on a Supabase branch first.**
2. **Migrate data** — run the idempotent cross-schema script; spot-check counts + a few fields/operations end-to-end.
3. **Re-anchor overlays** — point `product_prices` / `field_seasons` at the new ids.
4. **Rewrite app incrementally** — feature by feature against `fdh`; old schema stays as rollback.
5. **Retire `operations_center`** — only once every feature runs on v7 and is verified.

---

## Verification

- Row-count parity per table (old vs migrated); zero null `external_ref` on field/operation/product.
- Spot-check 3–5 fields: boundary renders (GeoJSON→geometry round-trip), acres sane (via geography), operations + per-product summaries intact, user-edits preserved.
- `npm run prebuild` (lint + typecheck + 88 vitest) green after each app change; Playwright per migrated feature.

---

## Safety (data-safety.md)

- Shared project — **every statement schema-qualified to `fdh.*`**; confirm linked ref `nuxofsjzrgdauzriraze` before any push.
- Migration phase is **additive** (new schema, `INSERT … SELECT`); no `DROP`/`DELETE` on `operations_center` until the final retire step, shown + approved.
- PostGIS install is project-level on a shared DB — additive, but confirm before running.
- JD tokens / customer org data: never echoed; Grimm Bros (external org) agronomic data handled per the customer-data rule.

---

## Decisions (resolved)

- **Schema name:** `fdh`.
- **RLS:** keep — baseline `authenticated`-only now, grower-keyed later (refinement 4).
- **Overlay home schema:** dedicated `farm_overlay` schema for `product_prices` / `field_seasons`, keeping `fdh` pure agronomic (my call; easy to change).
- **Yield-summary columns** (Fork 2): add summary cols to `operation` — proceeding unless overridden.
