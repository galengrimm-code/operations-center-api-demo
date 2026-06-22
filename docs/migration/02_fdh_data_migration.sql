-- =============================================================================
-- Farm Data Hub — DATA migration  operations_center -> fdh (+ farm_overlay)
-- Rev 2 (post-Codex): grower-safe joins, real unit mapping, ::date (start_date is
--   timestamptz), field_crop_year ON CONFLICT (uq_fcy_natural). ADDITIVE + IDEMPOTENT.
-- Verified source facts: areas in 'ac', yield 'bu1ac-1'(=bu/ac), mass 'lb';
--   0 null farm_name; all prices org 600550 (Precision Farms). No unit corruption.
-- DRY-RUN: BEGIN; <file>; <parity SELECT>; ROLLBACK;
-- =============================================================================
SET search_path = fdh, extensions, public;

-- 0. extra UOMs seen in source product totals (others already seeded)
INSERT INTO fdh.uom (code, name, dimension, requires_density) VALUES
  ('floz','Fluid ounce','volume',true),('ozm','Ounce (mass)','mass',false),
  ('pt','Pint','volume',true),('qt','Quart','volume',true)
ON CONFLICT (code) DO NOTHING;

-- 1. GROWER
INSERT INTO fdh.grower (grower_name, external_ref)
SELECT client_name, min(client_id) FROM operations_center.fields
WHERE client_name IS NOT NULL GROUP BY client_name
ON CONFLICT (grower_name) DO NOTHING;

-- 2. FARM
INSERT INTO fdh.farm (grower_id, farm_name, external_ref)
SELECT g.grower_id, f.farm_name, min(f.farm_id)
FROM operations_center.fields f JOIN fdh.grower g ON g.grower_name = f.client_name
WHERE f.farm_name IS NOT NULL GROUP BY g.grower_id, f.farm_name
ON CONFLICT (grower_id, farm_name) DO NOTHING;

-- 3. FIELD
INSERT INTO fdh.field (farm_id, grower_id, field_name, external_ref, source_type)
SELECT fm.farm_id, g.grower_id, f.name, f.jd_field_id, 'jdops'
FROM operations_center.fields f
JOIN fdh.grower g ON g.grower_name = f.client_name
JOIN fdh.farm  fm ON fm.grower_id = g.grower_id AND fm.farm_name = f.farm_name
WHERE f.jd_field_id IS NOT NULL
ON CONFLICT (grower_id, external_ref) DO NOTHING;

-- 4. FIELD_BOUNDARY (GeoJSON jsonb -> geometry; one per field)
INSERT INTO fdh.field_boundary (field_id, grower_id, geom, is_active, purpose, source)
SELECT fl.field_id, fl.grower_id,
       ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(f.boundary_geojson::text), 4326)),
       true, 'active', 'jdops'
FROM operations_center.fields f
JOIN fdh.grower g ON g.grower_name = f.client_name
JOIN fdh.field fl ON fl.grower_id = g.grower_id AND fl.external_ref = f.jd_field_id
WHERE f.boundary_geojson IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM fdh.field_boundary b WHERE b.field_id = fl.field_id);

-- 5. IRRIGATION (system + season-coverage + link), one pivot per irrigated field
DO $$
DECLARE r RECORD; sid uuid; cp uuid;
BEGIN
  SELECT irrigation_system_type_id INTO cp FROM fdh.irrigation_system_type WHERE code='center_pivot';
  FOR r IN
    SELECT fl.field_id, fl.grower_id, f.name, f.irrigated_boundary_geojson AS geo
    FROM operations_center.fields f
    JOIN fdh.grower g ON g.grower_name = f.client_name
    JOIN fdh.field fl ON fl.grower_id = g.grower_id AND fl.external_ref = f.jd_field_id
    WHERE f.has_irrigated_boundary AND f.irrigated_boundary_geojson IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fdh.field_irrigation fi WHERE fi.field_id = fl.field_id)
  LOOP
    INSERT INTO fdh.irrigation_system (grower_id, irrigation_system_type_id, name)
      VALUES (r.grower_id, cp, r.name || ' pivot') RETURNING irrigation_system_id INTO sid;
    INSERT INTO fdh.irrigation_coverage (irrigation_system_id, geom, is_active)
      VALUES (sid, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r.geo::text),4326)), true);
    INSERT INTO fdh.field_irrigation (field_id, irrigation_system_id) VALUES (r.field_id, sid);
  END LOOP;
END $$;

-- 6. PRODUCT CATALOG  (products are an org catalog -> grower_id NULL)
INSERT INTO fdh.product_concept (name, category)
SELECT name, min(product_category) FROM operations_center.products
WHERE name IS NOT NULL GROUP BY name
ON CONFLICT (name) DO NOTHING;

INSERT INTO fdh.product (product_concept_id, brand, density, external_ref)
SELECT pc.product_concept_id, p.brand, p.density_lbs_per_gal, p.jd_product_id
FROM operations_center.products p
JOIN fdh.product_concept pc ON pc.name = p.name
WHERE p.jd_product_id IS NOT NULL
ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING;

INSERT INTO fdh.product_nutrient (product_id, nutrient, pct, basis)
SELECT pr.product_id, 'N', p.nutrient_content_pct, 'elemental'
FROM operations_center.products p
JOIN fdh.product pr ON pr.external_ref = p.jd_product_id
WHERE p.nutrient_content_pct IS NOT NULL
ON CONFLICT (product_id, nutrient, basis) DO NOTHING;

-- 7. CROP SUBTYPE (Amylose) + FIELD_CROP_YEAR (known cash/cover crops)
INSERT INTO fdh.crop_subtype (crop_id, subtype_name, external_ref)
SELECT crop_id, 'Amylose', 'CORN_EURO' FROM fdh.crop WHERE crop_name='Corn'
ON CONFLICT (crop_id, subtype_name) DO NOTHING;

INSERT INTO fdh.field_crop_year (field_id, grower_id, season, crop_id, crop_subtype_id, land_use_status)
SELECT DISTINCT fl.field_id, fl.grower_id, fo.crop_season::int, c.crop_id, cs.crop_subtype_id,
   CASE WHEN COALESCE(fo.crop_name_override,fo.crop_name)='RYE' THEN 'cover_crop' ELSE 'cash_crop' END
FROM operations_center.field_operations fo
JOIN operations_center.fields sf ON sf.user_id=fo.user_id AND sf.org_id=fo.org_id AND sf.jd_field_id=fo.jd_field_id
JOIN fdh.grower g ON g.grower_name = sf.client_name
JOIN fdh.field fl ON fl.grower_id = g.grower_id AND fl.external_ref = fo.jd_field_id
JOIN fdh.crop c ON c.crop_name = CASE
        WHEN COALESCE(fo.crop_name_override,fo.crop_name) IN ('CORN_WET','CORN_EURO') THEN 'Corn'
        WHEN COALESCE(fo.crop_name_override,fo.crop_name)='SOYBEANS' THEN 'Soybeans'
        WHEN COALESCE(fo.crop_name_override,fo.crop_name)='RYE' THEN 'Rye' END
LEFT JOIN fdh.crop_subtype cs ON cs.crop_id=c.crop_id AND cs.external_ref = COALESCE(fo.crop_name_override,fo.crop_name)
WHERE fo.crop_season ~ '^\d{4}$'
  AND COALESCE(fo.crop_name_override,fo.crop_name) IN ('CORN_WET','CORN_EURO','SOYBEANS','RYE')
ON CONFLICT (field_id, grower_id, season, crop_id, crop_subtype_id) DO NOTHING;

-- 8. OPERATION (grower-safe; ::date; unit mapping; FCY link)
INSERT INTO fdh.operation
  (grower_id, field_id, field_crop_year_id, operation_type_id, operation_date, season,
   source_type, external_ref, avg_yield_value, avg_yield_uom_id, avg_moisture,
   total_mass_value, total_mass_uom_id, area_value, area_uom_id, variety_name, machine_name)
SELECT fl.grower_id, fl.field_id, y.field_crop_year_id, ot.operation_type_id,
   fo.start_date::date,
   CASE WHEN fo.crop_season ~ '^\d{4}$' THEN fo.crop_season::int END,
   fo.measurement_type, fo.jd_operation_id,
   fo.avg_yield_value,
   (SELECT uom_id FROM fdh.uom WHERE code = CASE WHEN fo.avg_yield_unit='bu1ac-1' THEN 'bu_ac' ELSE fo.avg_yield_unit END),
   fo.avg_moisture,
   fo.total_wet_mass_value, (SELECT uom_id FROM fdh.uom WHERE code = fo.total_wet_mass_unit),
   fo.area_value, (SELECT uom_id FROM fdh.uom WHERE code = fo.area_unit),
   fo.variety_name, fo.machine_name
FROM operations_center.field_operations fo
JOIN operations_center.fields sf ON sf.user_id=fo.user_id AND sf.org_id=fo.org_id AND sf.jd_field_id=fo.jd_field_id
JOIN fdh.grower g ON g.grower_name = sf.client_name
JOIN fdh.field fl ON fl.grower_id = g.grower_id AND fl.external_ref = fo.jd_field_id
JOIN fdh.operation_type ot ON ot.code = fo.operation_type
LEFT JOIN fdh.crop c ON c.crop_name = CASE
        WHEN COALESCE(fo.crop_name_override,fo.crop_name) IN ('CORN_WET','CORN_EURO') THEN 'Corn'
        WHEN COALESCE(fo.crop_name_override,fo.crop_name)='SOYBEANS' THEN 'Soybeans'
        WHEN COALESCE(fo.crop_name_override,fo.crop_name)='RYE' THEN 'Rye' END
LEFT JOIN fdh.crop_subtype cs ON cs.crop_id=c.crop_id AND cs.external_ref = COALESCE(fo.crop_name_override,fo.crop_name)
LEFT JOIN fdh.field_crop_year y ON y.field_id=fl.field_id AND y.grower_id=fl.grower_id
        AND fo.crop_season ~ '^\d{4}$' AND y.season=fo.crop_season::int
        AND y.crop_id=c.crop_id AND y.crop_subtype_id IS NOT DISTINCT FROM cs.crop_subtype_id
WHERE fo.jd_operation_id IS NOT NULL
  AND COALESCE(fo.crop_name_override,fo.crop_name) IS DISTINCT FROM 'GRASSLAND'
  AND COALESCE(fo.crop_name_override,fo.crop_name) IS DISTINCT FROM 'HARD_FESCUE_GRASS'
ON CONFLICT (grower_id, external_ref) DO NOTHING;

-- 9. OPERATION_PRODUCT (active lines; uom from total_unit; area_value already in ac)
INSERT INTO fdh.operation_product
  (operation_id, product_id, line_index, total_amount, uom_id, area_covered_acres, avg_rate,
   is_user_edited, edited_at, jd_original)
SELECT op.operation_id, pr.product_id, fop.line_index, fop.total_value,
   (SELECT uom_id FROM fdh.uom WHERE code = fop.total_unit),
   fop.area_value, fop.rate_value,
   COALESCE(fop.is_user_edited,false), fop.edited_at,
   jsonb_strip_nulls(jsonb_build_object(
     'rate_jd', fop.rate_value_jd_original, 'total_jd', fop.total_value_jd_original,
     'area_jd', fop.area_value_jd_original, 'rate_unit', fop.rate_unit, 'total_unit', fop.total_unit))
FROM operations_center.field_operation_products fop
JOIN operations_center.field_operations fo ON fo.id = fop.field_operation_id
JOIN operations_center.fields sf ON sf.user_id=fo.user_id AND sf.org_id=fo.org_id AND sf.jd_field_id=fo.jd_field_id
JOIN fdh.grower g ON g.grower_name = sf.client_name
JOIN fdh.operation op ON op.grower_id = g.grower_id AND op.external_ref = fo.jd_operation_id
JOIN operations_center.products p ON p.id = fop.product_id
JOIN fdh.product pr ON pr.external_ref = p.jd_product_id
WHERE fop.deleted_at IS NULL
ON CONFLICT (operation_id, line_index) DO NOTHING;

-- 10. OVERLAY: product_price (all source prices = Precision Farms cost)
INSERT INTO farm_overlay.product_price (grower_id, product_id, external_product_ref, year, price_per_unit, price_unit)
SELECT (SELECT grower_id FROM fdh.grower WHERE grower_name='Precision Farms'),
   pr.product_id, p.jd_product_id, pp.year, pp.price_per_unit, pp.price_unit
FROM operations_center.product_prices pp
JOIN operations_center.products p ON p.id = pp.product_id
JOIN fdh.product pr ON pr.external_ref = p.jd_product_id
ON CONFLICT (grower_id, product_id, year) DO NOTHING;
-- =============================================================================
-- DONE (rev 2). Expected parity: grower 2, field 71, field_boundary 68,
--   irrigation_system 18, operation 1682 (1686-4 grass).
-- =============================================================================
