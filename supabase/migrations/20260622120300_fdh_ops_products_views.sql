-- =============================================================================
-- Farm Data Hub — Track 2 R1  OPS/PRODUCTS reverse adapter views (operations_center.fdh_*)
-- Reconstruct the legacy flat shapes from fdh core (agronomic) + farm_overlay (FDH edit/display)
-- + farm_overlay.product_price. security_invoker so fdh operator-RLS applies. Temporary
-- strangler layer; dropped once the app reads fdh natively. Parity-proven byte-exact vs legacy:
--   field_operations 1682/1682, field_operation_products 4889/4889 (incl FK ids + jd_originals),
--   products 173/173, product_prices 8/8. All 0 mismatches (2026-06-16).
--
-- id PASSTHROUGH: every id / FK column is the LEGACY uuid (via INNER joins lo/lp/lfop/lpp),
-- so the app's write-by-id (editProductLine, editApplicationName, editProductCategory,
-- upsertProductPrice...) hits the legacy row and the write-sync triggers (R3) propagate it back
-- to fdh+overlay. Flips to fdh ids when legacy retires.
--
-- CODEX-HARDENED 2026-06-16 (single-user/single-org today; these protect multi-org + post-cutover):
--  P1 multiplication: legacy joins scoped by org (lo/lp ON ... AND org_id = f.external_org_ref) so a
--     second org importing the same JD ids can't fan out one fdh row into N and overcount cost sums.
--  P1 null-id: legacy joins are INNER (not LEFT) — an fdh row with no legacy match (future fdh-native
--     insert / partial write-sync) is dropped rather than surfacing a row with NULL id/FK the app
--     can't price or mutate. (Flip to fdh-uuid fallback only when legacy is retired + writes move to fdh.)
--  P2 RLS divergence: user_id sourced from the matched legacy row (lo/lp/lpp.user_id), not the operator
--     subquery; INNER join + legacy owner-RLS keeps browser and service-role reads consistent.
--  P3 unit map: bu_ac->bu1ac-1 applied ONLY to avg_yield_unit (the one the forward migration aliased);
--     area_unit / total_wet_mass_unit pass through, so a future bu_ac on those can't fabricate a unit.
--  P3 jd_original: numeric-guarded casts (jsonb_typeof = 'number') so malformed future jd_original
--     yields NULL instead of erroring the whole view.
--
-- Prereq overlay columns on farm_overlay.operation_edit beyond 05 (raw JD values fdh core normalizes/
-- drops, preserved for exact reconstruction): crop_season, crop_name, start_date, end_date,
-- machine_vin, map_image_path, map_image_extent, map_image_legends.
--
-- KNOWN GAP (flagged, not yet decided): 4 GRASSLAND/HARD_FESCUE ops were excluded from fdh in 02, so
-- these views omit them (1682 vs legacy 1686). hidden_crop_names is empty and only RYE is in
-- GLOBALLY_EXCLUDED_CROPS, so the CURRENT app still SHOWS those 4 — post-cutover they disappear (matches
-- the "throw grass" decision). To make current == post-cutover, add GRASSLAND/HARD_FESCUE_GRASS to
-- lib/crop-filter.ts GLOBALLY_EXCLUDED_CROPS before flipping reads.
--
-- MULTI-ORG LIMITATION: fdh.product is an org-agnostic catalog (grower_id null, no org). fdh_products /
-- fdh_product_prices scope the legacy product join by jd_product_id only; correct for one org, but a
-- true multi-org product story needs an org key on fdh.product. Out of scope for the single-org cutover.
-- =============================================================================

CREATE OR REPLACE VIEW operations_center.fdh_field_operations WITH (security_invoker=true) AS
SELECT
  lo.id AS id,
  lo.user_id AS user_id,
  f.external_org_ref AS org_id,
  f.external_ref AS jd_field_id,
  op.external_ref AS jd_operation_id,
  ot.code AS operation_type,
  oe.crop_season, oe.crop_name, oe.start_date, oe.end_date,
  op.variety_name, op.machine_name, oe.machine_vin,
  op.area_value, au.code AS area_unit,
  op.avg_yield_value,
  CASE WHEN yu.code='bu_ac' THEN 'bu1ac-1' ELSE yu.code END AS avg_yield_unit,
  op.avg_moisture,
  op.total_mass_value AS total_wet_mass_value, mu.code AS total_wet_mass_unit,
  op.source_type AS measurement_type,
  oe.map_image_path, oe.map_image_extent, oe.map_image_legends,
  NULL::jsonb AS raw_response,
  op.date_created AS imported_at, op.date_created AS created_at, op.date_modified AS updated_at,
  oe.measurement_status, oe.application_name, oe.application_name_jd_original,
  oe.application_name_user_edited, oe.crop_name_override
FROM fdh.operation op
JOIN fdh.field f ON f.field_id = op.field_id
JOIN fdh.operation_type ot ON ot.operation_type_id = op.operation_type_id
JOIN farm_overlay.operation_edit oe ON oe.operation_id = op.operation_id
LEFT JOIN fdh.uom au ON au.uom_id = op.area_uom_id
LEFT JOIN fdh.uom yu ON yu.uom_id = op.avg_yield_uom_id
LEFT JOIN fdh.uom mu ON mu.uom_id = op.total_mass_uom_id
JOIN operations_center.field_operations lo
  ON lo.jd_operation_id = op.external_ref AND lo.org_id = f.external_org_ref;

CREATE OR REPLACE VIEW operations_center.fdh_field_operation_products WITH (security_invoker=true) AS
SELECT
  lfop.id AS id,
  lfop.user_id AS user_id,
  f.external_org_ref AS org_id,
  lo.id AS field_operation_id,
  lp.id AS product_id,
  opx.line_index,
  oe.product_category_override, oe.is_carrier,
  oe.rate_value, oe.rate_unit, oe.rate_variable,
  oe.total_value, oe.total_unit, oe.total_variable,
  oe.area_value, oe.area_unit,
  CASE WHEN jsonb_typeof(opx.jd_original->'rate_jd') ='number' THEN (opx.jd_original->>'rate_jd')::double precision  END AS rate_value_jd_original,
  CASE WHEN jsonb_typeof(opx.jd_original->'total_jd')='number' THEN (opx.jd_original->>'total_jd')::double precision END AS total_value_jd_original,
  CASE WHEN jsonb_typeof(opx.jd_original->'area_jd') ='number' THEN (opx.jd_original->>'area_jd')::double precision  END AS area_value_jd_original,
  oe.is_user_edited, oe.edited_at, oe.deleted_at,
  NULL::jsonb AS raw_response,
  opx.date_created AS created_at, opx.date_modified AS updated_at
FROM fdh.operation_product opx
JOIN fdh.operation op ON op.operation_id = opx.operation_id
JOIN fdh.field f ON f.field_id = op.field_id
JOIN fdh.product pr ON pr.product_id = opx.product_id
JOIN farm_overlay.operation_product_edit oe ON oe.operation_product_id = opx.operation_product_id
JOIN operations_center.field_operations lo
  ON lo.jd_operation_id = op.external_ref AND lo.org_id = f.external_org_ref
JOIN operations_center.products lp
  ON lp.jd_product_id = pr.external_ref AND lp.org_id = f.external_org_ref
JOIN operations_center.field_operation_products lfop
  ON lfop.field_operation_id = lo.id AND lfop.line_index = opx.line_index;

CREATE OR REPLACE VIEW operations_center.fdh_products WITH (security_invoker=true) AS
SELECT
  lp.id AS id,
  lp.user_id AS user_id,
  lp.org_id AS org_id,
  pr.external_ref AS jd_product_id,
  pc.name AS name, pm.name_normalized, pr.brand,
  pm.is_carrier_default, pm.product_kind, pm.product_category, pm.product_category_source,
  pm.default_unit, pr.density AS density_lbs_per_gal, pn.pct AS nutrient_content_pct,
  pm.price_unit_default, lp.first_seen_at, lp.last_seen_at,
  NULL::jsonb AS raw_response,
  pr.date_created AS created_at, pr.date_modified AS updated_at
FROM fdh.product pr
JOIN fdh.product_concept pc ON pc.product_concept_id = pr.product_concept_id
JOIN farm_overlay.product_meta pm ON pm.product_id = pr.product_id
LEFT JOIN fdh.product_nutrient pn ON pn.product_id = pr.product_id AND pn.nutrient='N'
JOIN operations_center.products lp ON lp.jd_product_id = pr.external_ref;

CREATE OR REPLACE VIEW operations_center.fdh_product_prices WITH (security_invoker=true) AS
SELECT
  lpp.id AS id,
  lpp.user_id AS user_id,
  lpp.org_id AS org_id,
  lp.id AS product_id,
  fpp.year, fpp.price_per_unit, fpp.price_unit,
  fpp.date_created AS created_at, fpp.date_modified AS updated_at
FROM farm_overlay.product_price fpp
JOIN fdh.product pr ON pr.product_id = fpp.product_id
JOIN operations_center.products lp ON lp.jd_product_id = pr.external_ref
JOIN operations_center.product_prices lpp ON lpp.product_id = lp.id AND lpp.year = fpp.year;

GRANT SELECT ON operations_center.fdh_field_operations, operations_center.fdh_field_operation_products,
                operations_center.fdh_products, operations_center.fdh_product_prices
  TO authenticated, service_role;
-- =============================================================================
