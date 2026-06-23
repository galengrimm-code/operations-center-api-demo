-- =============================================================================
-- Farm Data Hub — Track 2 adapter views  (operations_center.fdh_*)
-- Strangler layer: views in the ALREADY-EXPOSED operations_center schema that
-- present fdh data in the OLD operations_center table SHAPE, so the app can read
-- fdh with `supabase.from('fdh_<x>')` — no client/schema-exposure change, fully
-- reversible (DROP VIEW). security_invoker => fdh operator-RLS (is_operator) applies.
-- These are TEMPORARY: dropped once the app is refactored to native fdh shapes.
-- =============================================================================

-- Additive columns on fdh.field so adapters can satisfy the app's filters/shape,
-- backfilled from operations_center (hand-entered data the first migration missed).
ALTER TABLE fdh.field ADD COLUMN IF NOT EXISTS external_org_ref      text;
ALTER TABLE fdh.field ADD COLUMN IF NOT EXISTS irrigation_start_year integer;
UPDATE fdh.field fl SET external_org_ref = oc.org_id
  FROM operations_center.fields oc
  WHERE oc.jd_field_id = fl.external_ref AND fl.external_org_ref IS NULL;
UPDATE fdh.field fl SET irrigation_start_year = oc.irrigation_start_year
  FROM operations_center.fields oc
  WHERE oc.jd_field_id = fl.external_ref AND oc.irrigation_start_year IS NOT NULL
    AND fl.irrigation_start_year IS DISTINCT FROM oc.irrigation_start_year;

-- ---- fdh_fields : mirrors operations_center.fields (read path: browser + edge fn) ----
-- user_id from the operator record (NOT auth.uid()): the get-stored-fields edge
-- function runs as service_role and filters .eq('user_id', user.id); auth.uid() is
-- null there. The operator uid satisfies both the edge fn and browser reads.
-- id = the LEGACY operations_center.fields.id (via the lf join), NOT fdh.field_id:
-- the app still WRITES legacy by id (e.g. updateIrrigationStartYear .eq('id', fieldId)),
-- so read-id must equal write-target-id or the write hits 0 rows. The write-sync trigger
-- then propagates the legacy edit back into fdh. (Flips to fdh id when legacy is retired.)
DROP VIEW IF EXISTS operations_center.fdh_fields;
CREATE VIEW operations_center.fdh_fields
WITH (security_invoker = true) AS
SELECT
  COALESCE(lf.id, f.field_id)        AS id,
  (SELECT user_id FROM fdh.operator ORDER BY added_at LIMIT 1) AS user_id,
  f.external_org_ref                 AS org_id,
  f.external_ref                     AS jd_field_id,
  f.field_name                       AS name,
  ST_AsGeoJSON(b.geom)::jsonb        AS boundary_geojson,
  b.acres                            AS boundary_area_value,
  'ac'::text                         AS boundary_area_unit,
  COALESCE(b.is_active, false)       AS active_boundary,
  ST_AsGeoJSON(ic.geom)::jsonb       AS irrigated_boundary_geojson,
  (ST_Area(ic.geom::geography)/4046.8564224) AS irrigated_boundary_area_value,
  'ac'::text                         AS irrigated_boundary_area_unit,
  (ic.geom IS NOT NULL)              AS has_irrigated_boundary,
  f.irrigation_start_year            AS irrigation_start_year,
  g.grower_name                      AS client_name,
  g.external_ref                     AS client_id,
  fm.farm_name                       AS farm_name,
  fm.external_ref                    AS farm_id,
  NULL::jsonb                        AS raw_response,
  f.date_created                     AS imported_at,
  f.date_created                     AS created_at,
  f.date_modified                    AS updated_at
FROM fdh.field f
JOIN fdh.grower g  ON g.grower_id = f.grower_id
JOIN fdh.farm  fm  ON fm.farm_id  = f.farm_id
LEFT JOIN fdh.field_boundary b ON b.field_id = f.field_id AND b.is_active
LEFT JOIN fdh.field_irrigation fi ON fi.field_id = f.field_id
LEFT JOIN fdh.irrigation_coverage ic ON ic.irrigation_system_id = fi.irrigation_system_id AND ic.is_active
LEFT JOIN operations_center.fields lf ON lf.jd_field_id = f.external_ref AND lf.org_id = f.external_org_ref;
-- NOTE: assumes <=1 active irrigation system per field (true post-migration).
-- lf join = legacy-id passthrough so the app's write-by-id round-trips (see header).

GRANT SELECT ON operations_center.fdh_fields TO authenticated, service_role;

-- TODO (next adapters, same pattern): fdh_field_operations, fdh_field_operation_products,
--   fdh_products, fdh_product_prices.
-- =============================================================================
-- Validated 2026-06-16: 71 fields, 68 boundaries, 18 irrigated, GeoJSON MultiPolygon
-- round-trip OK, org_id=600550, irrigation_start_year 17=17, user_id resolves.
-- =============================================================================
