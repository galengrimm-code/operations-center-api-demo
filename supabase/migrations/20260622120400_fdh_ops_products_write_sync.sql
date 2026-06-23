-- =============================================================================
-- Farm Data Hub — Track 2 R3  OPS/PRODUCTS write-sync triggers (legacy -> fdh + farm_overlay)
-- The app keeps WRITING the legacy operations_center tables (JD re-import + cost edits). These
-- AFTER triggers decompose each legacy write into fdh core (agronomic) + farm_overlay (edit layer)
-- so the reverse views (06) reflect the change. Mirrors the forward migration (02) per-row with
-- UPSERT semantics, and the field trigger (04) fail-open pattern: data errors WARN (never break the
-- legacy write — legacy stays the durable record); STRUCTURAL errors RE-RAISE (real defect, fail loud).
-- SECURITY DEFINER (browser writes as authenticated, which lacks fdh/farm_overlay INSERT).
-- Reversible: DROP the 4 triggers. Required BEFORE flipping ops/products reads (R4).
--
-- CODEX-REVIEWED 2026-06-16; fixes applied + tested (edit round-trips, synthetic re-import,
-- soft-delete removal, unknown-type fail-open all verified in BEGIN/ROLLBACK):
--  P1 soft-delete: a legacy line with deleted_at set is REMOVED from fdh.operation_product (matches
--     02's deleted_at exclusion); the overlay row cascades via FK. Not just overlay-flagged.
--  P1 price grower: product-not-synced-yet stays soft (transient, WARN+return); a MISSING price-owner
--     grower fails LOUD (RAISE; P0001 in the re-raise list) — silent stale pricing is worse than a
--     loud failed edit. (Grower still resolved by name 'Precision Farms' — single-operator convention.)
--  P2 subtype: CORN_EURO crop_subtype lookup scoped by (crop_id, external_ref) like 02, not external_ref alone.
--  P3 operation_type: an unknown/case-drifted code now WARN+returns (fail-open) instead of hitting the
--     operation_type_id NOT NULL and re-raising 23502 — a new JD code can't break a re-import.
--
-- Trigger ordering (verified): import writes field_operations -> products -> field_operation_products,
-- so an opx line's parent op/product are synced first. The legacy autofill trigger on
-- field_operation_products is BEFORE INSERT, so it runs before this AFTER sync trigger regardless of name.
-- Price grower convention (matches 02 block 10): prices are the operator's own cost, grower 'Precision Farms'.
-- =============================================================================

-- ---- 1. products -> product_concept + product + product_nutrient + product_meta ----
CREATE OR REPLACE FUNCTION farm_overlay.fn_sync_product_from_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fdh, farm_overlay, extensions AS $$
DECLARE v_concept uuid; v_product uuid;
BEGIN
  IF NEW.jd_product_id IS NULL OR NEW.name IS NULL THEN RETURN NEW; END IF;
  INSERT INTO fdh.product_concept (name, category) VALUES (NEW.name, NEW.product_category)
    ON CONFLICT (name) DO UPDATE SET category = COALESCE(EXCLUDED.category, fdh.product_concept.category)
    RETURNING product_concept_id INTO v_concept;
  INSERT INTO fdh.product (product_concept_id, brand, density, external_ref)
    VALUES (v_concept, NEW.brand, NEW.density_lbs_per_gal, NEW.jd_product_id)
    ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
      DO UPDATE SET product_concept_id = EXCLUDED.product_concept_id, brand = EXCLUDED.brand,
                    density = EXCLUDED.density, date_modified = now()
    RETURNING product_id INTO v_product;
  IF NEW.nutrient_content_pct IS NOT NULL THEN
    INSERT INTO fdh.product_nutrient (product_id, nutrient, pct, basis)
      VALUES (v_product, 'N', NEW.nutrient_content_pct, 'elemental')
      ON CONFLICT (product_id, nutrient, basis) DO UPDATE SET pct = EXCLUDED.pct;
  ELSE
    DELETE FROM fdh.product_nutrient WHERE product_id = v_product AND nutrient='N' AND basis='elemental';
  END IF;
  INSERT INTO farm_overlay.product_meta
    (product_id, product_category, product_category_source, default_unit, price_unit_default,
     is_carrier_default, name_normalized, product_kind)
    VALUES (v_product, NEW.product_category, NEW.product_category_source, NEW.default_unit, NEW.price_unit_default,
            COALESCE(NEW.is_carrier_default,false), NEW.name_normalized, NEW.product_kind)
    ON CONFLICT (product_id) DO UPDATE SET
      product_category = EXCLUDED.product_category, product_category_source = EXCLUDED.product_category_source,
      default_unit = EXCLUDED.default_unit, price_unit_default = EXCLUDED.price_unit_default,
      is_carrier_default = EXCLUDED.is_carrier_default, name_normalized = EXCLUDED.name_normalized,
      product_kind = EXCLUDED.product_kind, date_modified = now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = ANY (ARRAY['23502','23503','23505','42501','42703','42883','42P01']) THEN RAISE; END IF;
  RAISE WARNING 'fdh product-sync skipped jd_product_id=%: % (%)', NEW.jd_product_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

-- ---- 2. product_prices -> farm_overlay.product_price ----
CREATE OR REPLACE FUNCTION farm_overlay.fn_sync_product_price_from_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fdh, farm_overlay, extensions AS $$
DECLARE v_jd text; v_product uuid; v_grower uuid;
BEGIN
  SELECT jd_product_id INTO v_jd FROM operations_center.products WHERE id = NEW.product_id;
  IF v_jd IS NULL THEN RETURN NEW; END IF;
  SELECT product_id INTO v_product FROM fdh.product WHERE external_ref = v_jd;
  IF v_product IS NULL THEN
    RAISE WARNING 'fdh price-sync: product not synced yet jd=%', v_jd; RETURN NEW;   -- transient: soft
  END IF;
  SELECT grower_id INTO v_grower FROM fdh.grower WHERE grower_name = 'Precision Farms';
  IF v_grower IS NULL THEN
    RAISE EXCEPTION 'fdh price-sync: price-owner grower "Precision Farms" missing (config defect)';  -- loud
  END IF;
  INSERT INTO farm_overlay.product_price (grower_id, product_id, external_product_ref, year, price_per_unit, price_unit)
    VALUES (v_grower, v_product, v_jd, NEW.year, NEW.price_per_unit, NEW.price_unit)
    ON CONFLICT (grower_id, product_id, year)
      DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit, price_unit = EXCLUDED.price_unit, date_modified = now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = ANY (ARRAY['23502','23503','23505','42501','42703','42883','42P01','P0001']) THEN RAISE; END IF;
  RAISE WARNING 'fdh price-sync skipped product_id=% year=%: % (%)', NEW.product_id, NEW.year, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

-- ---- 3. field_operations -> fdh.operation (+ field_crop_year) + farm_overlay.operation_edit ----
CREATE OR REPLACE FUNCTION farm_overlay.fn_sync_operation_from_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fdh, farm_overlay, extensions AS $$
DECLARE v_field uuid; v_grower uuid; v_optype uuid; v_crop uuid; v_subtype uuid; v_fcy uuid; v_op uuid; v_eff text;
BEGIN
  IF NEW.jd_operation_id IS NULL OR NEW.jd_field_id IS NULL THEN RETURN NEW; END IF;
  v_eff := COALESCE(NEW.crop_name_override, NEW.crop_name);
  IF v_eff IN ('GRASSLAND','HARD_FESCUE_GRASS') THEN RETURN NEW; END IF;   -- excluded from fdh (matches 02)
  SELECT fl.field_id, fl.grower_id INTO v_field, v_grower
    FROM fdh.field fl WHERE fl.external_ref = NEW.jd_field_id AND fl.external_org_ref = NEW.org_id LIMIT 1;
  IF v_field IS NULL THEN
    RAISE WARNING 'fdh op-sync: no fdh.field for jd_field_id=% org=%', NEW.jd_field_id, NEW.org_id; RETURN NEW;
  END IF;
  SELECT operation_type_id INTO v_optype FROM fdh.operation_type WHERE code = NEW.operation_type;
  IF v_optype IS NULL THEN
    RAISE WARNING 'fdh op-sync: unknown operation_type=% — skipped', NEW.operation_type; RETURN NEW;  -- fail-open, not 23502
  END IF;
  IF v_eff IN ('CORN_WET','CORN_EURO') THEN SELECT crop_id INTO v_crop FROM fdh.crop WHERE crop_name='Corn';
  ELSIF v_eff = 'SOYBEANS' THEN SELECT crop_id INTO v_crop FROM fdh.crop WHERE crop_name='Soybeans';
  ELSIF v_eff = 'RYE' THEN SELECT crop_id INTO v_crop FROM fdh.crop WHERE crop_name='Rye';
  END IF;
  IF v_eff = 'CORN_EURO' THEN
    SELECT crop_subtype_id INTO v_subtype FROM fdh.crop_subtype WHERE crop_id = v_crop AND external_ref = v_eff LIMIT 1;
  END IF;
  IF v_crop IS NOT NULL AND NEW.crop_season ~ '^\d{4}$' THEN
    INSERT INTO fdh.field_crop_year (field_id, grower_id, season, crop_id, crop_subtype_id, land_use_status)
      VALUES (v_field, v_grower, NEW.crop_season::int, v_crop, v_subtype,
              CASE WHEN v_eff='RYE' THEN 'cover_crop' ELSE 'cash_crop' END)
      ON CONFLICT (field_id, grower_id, season, crop_id, crop_subtype_id) DO NOTHING;
    SELECT field_crop_year_id INTO v_fcy FROM fdh.field_crop_year
      WHERE field_id=v_field AND grower_id=v_grower AND season=NEW.crop_season::int
        AND crop_id=v_crop AND crop_subtype_id IS NOT DISTINCT FROM v_subtype;
  END IF;
  INSERT INTO fdh.operation
    (grower_id, field_id, field_crop_year_id, operation_type_id, operation_date, season, source_type, external_ref,
     avg_yield_value, avg_yield_uom_id, avg_moisture, total_mass_value, total_mass_uom_id, area_value, area_uom_id,
     variety_name, machine_name)
    VALUES (v_grower, v_field, v_fcy, v_optype, NEW.start_date::date,
      CASE WHEN NEW.crop_season ~ '^\d{4}$' THEN NEW.crop_season::int END, NEW.measurement_type, NEW.jd_operation_id,
      NEW.avg_yield_value, (SELECT uom_id FROM fdh.uom WHERE code = CASE WHEN NEW.avg_yield_unit='bu1ac-1' THEN 'bu_ac' ELSE NEW.avg_yield_unit END),
      NEW.avg_moisture, NEW.total_wet_mass_value, (SELECT uom_id FROM fdh.uom WHERE code = NEW.total_wet_mass_unit),
      NEW.area_value, (SELECT uom_id FROM fdh.uom WHERE code = NEW.area_unit), NEW.variety_name, NEW.machine_name)
    ON CONFLICT (grower_id, external_ref) DO UPDATE SET
      field_id=EXCLUDED.field_id, field_crop_year_id=EXCLUDED.field_crop_year_id, operation_type_id=EXCLUDED.operation_type_id,
      operation_date=EXCLUDED.operation_date, season=EXCLUDED.season, source_type=EXCLUDED.source_type,
      avg_yield_value=EXCLUDED.avg_yield_value, avg_yield_uom_id=EXCLUDED.avg_yield_uom_id, avg_moisture=EXCLUDED.avg_moisture,
      total_mass_value=EXCLUDED.total_mass_value, total_mass_uom_id=EXCLUDED.total_mass_uom_id,
      area_value=EXCLUDED.area_value, area_uom_id=EXCLUDED.area_uom_id,
      variety_name=EXCLUDED.variety_name, machine_name=EXCLUDED.machine_name, date_modified=now()
    RETURNING operation_id INTO v_op;
  INSERT INTO farm_overlay.operation_edit
    (operation_id, grower_id, application_name, application_name_jd_original, application_name_user_edited,
     crop_name_override, measurement_status, crop_season, crop_name, start_date, end_date, machine_vin,
     map_image_path, map_image_extent, map_image_legends)
    VALUES (v_op, v_grower, NEW.application_name, NEW.application_name_jd_original,
      COALESCE(NEW.application_name_user_edited,false), NEW.crop_name_override, NEW.measurement_status,
      NEW.crop_season, NEW.crop_name, NEW.start_date, NEW.end_date, NEW.machine_vin,
      NEW.map_image_path, NEW.map_image_extent, NEW.map_image_legends)
    ON CONFLICT (operation_id) DO UPDATE SET
      application_name=EXCLUDED.application_name, application_name_jd_original=EXCLUDED.application_name_jd_original,
      application_name_user_edited=EXCLUDED.application_name_user_edited, crop_name_override=EXCLUDED.crop_name_override,
      measurement_status=EXCLUDED.measurement_status, crop_season=EXCLUDED.crop_season, crop_name=EXCLUDED.crop_name,
      start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, machine_vin=EXCLUDED.machine_vin,
      map_image_path=EXCLUDED.map_image_path, map_image_extent=EXCLUDED.map_image_extent,
      map_image_legends=EXCLUDED.map_image_legends, date_modified=now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = ANY (ARRAY['23502','23503','23505','42501','42703','42883','42P01','P0001']) THEN RAISE; END IF;
  RAISE WARNING 'fdh op-sync skipped jd_operation_id=%: % (%)', NEW.jd_operation_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

-- ---- 4. field_operation_products -> fdh.operation_product + farm_overlay.operation_product_edit ----
CREATE OR REPLACE FUNCTION farm_overlay.fn_sync_operation_product_from_legacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, fdh, farm_overlay, extensions AS $$
DECLARE v_jd_op text; v_jd_prod text; v_op uuid; v_product uuid; v_opx uuid;
BEGIN
  SELECT fo.jd_operation_id INTO v_jd_op FROM operations_center.field_operations fo WHERE fo.id = NEW.field_operation_id;
  SELECT jd_product_id INTO v_jd_prod FROM operations_center.products WHERE id = NEW.product_id;
  IF v_jd_op IS NULL OR v_jd_prod IS NULL THEN RETURN NEW; END IF;
  SELECT operation_id INTO v_op FROM fdh.operation WHERE external_ref = v_jd_op;
  SELECT product_id  INTO v_product FROM fdh.product WHERE external_ref = v_jd_prod;
  IF v_op IS NULL OR v_product IS NULL THEN
    RAISE WARNING 'fdh opx-sync: unresolved op(%) / product(%)', v_jd_op, v_jd_prod; RETURN NEW;
  END IF;
  -- soft-deleted legacy line: remove from fdh core to match migration exclusion; overlay cascades (FK ON DELETE CASCADE)
  IF NEW.deleted_at IS NOT NULL THEN
    DELETE FROM fdh.operation_product WHERE operation_id = v_op AND line_index = NEW.line_index;
    RETURN NEW;
  END IF;
  INSERT INTO fdh.operation_product
    (operation_id, product_id, line_index, total_amount, uom_id, area_covered_acres, avg_rate, is_user_edited, edited_at, jd_original)
    VALUES (v_op, v_product, NEW.line_index, NEW.total_value, (SELECT uom_id FROM fdh.uom WHERE code = NEW.total_unit),
      NEW.area_value, NEW.rate_value, COALESCE(NEW.is_user_edited,false), NEW.edited_at,
      jsonb_strip_nulls(jsonb_build_object('rate_jd', NEW.rate_value_jd_original, 'total_jd', NEW.total_value_jd_original,
        'area_jd', NEW.area_value_jd_original, 'rate_unit', NEW.rate_unit, 'total_unit', NEW.total_unit)))
    ON CONFLICT (operation_id, line_index) DO UPDATE SET
      product_id=EXCLUDED.product_id, total_amount=EXCLUDED.total_amount, uom_id=EXCLUDED.uom_id,
      area_covered_acres=EXCLUDED.area_covered_acres, avg_rate=EXCLUDED.avg_rate, is_user_edited=EXCLUDED.is_user_edited,
      edited_at=EXCLUDED.edited_at, jd_original=EXCLUDED.jd_original, date_modified=now()
    RETURNING operation_product_id INTO v_opx;
  INSERT INTO farm_overlay.operation_product_edit
    (operation_product_id, product_category_override, is_carrier, rate_value, rate_unit, rate_variable,
     total_value, total_unit, total_variable, area_value, area_unit, is_user_edited, edited_at, deleted_at)
    VALUES (v_opx, NEW.product_category_override, COALESCE(NEW.is_carrier,false), NEW.rate_value, NEW.rate_unit, NEW.rate_variable,
      NEW.total_value, NEW.total_unit, NEW.total_variable, NEW.area_value, NEW.area_unit,
      COALESCE(NEW.is_user_edited,false), NEW.edited_at, NEW.deleted_at)
    ON CONFLICT (operation_product_id) DO UPDATE SET
      product_category_override=EXCLUDED.product_category_override, is_carrier=EXCLUDED.is_carrier,
      rate_value=EXCLUDED.rate_value, rate_unit=EXCLUDED.rate_unit, rate_variable=EXCLUDED.rate_variable,
      total_value=EXCLUDED.total_value, total_unit=EXCLUDED.total_unit, total_variable=EXCLUDED.total_variable,
      area_value=EXCLUDED.area_value, area_unit=EXCLUDED.area_unit, is_user_edited=EXCLUDED.is_user_edited,
      edited_at=EXCLUDED.edited_at, deleted_at=EXCLUDED.deleted_at, date_modified=now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = ANY (ARRAY['23502','23503','23505','42501','42703','42883','42P01','P0001']) THEN RAISE; END IF;
  RAISE WARNING 'fdh opx-sync skipped fop=% line=%: % (%)', NEW.field_operation_id, NEW.line_index, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_product_to_fdh ON operations_center.products;
CREATE TRIGGER trg_sync_product_to_fdh AFTER INSERT OR UPDATE ON operations_center.products
  FOR EACH ROW EXECUTE FUNCTION farm_overlay.fn_sync_product_from_legacy();
DROP TRIGGER IF EXISTS trg_sync_price_to_fdh ON operations_center.product_prices;
CREATE TRIGGER trg_sync_price_to_fdh AFTER INSERT OR UPDATE ON operations_center.product_prices
  FOR EACH ROW EXECUTE FUNCTION farm_overlay.fn_sync_product_price_from_legacy();
DROP TRIGGER IF EXISTS trg_sync_operation_to_fdh ON operations_center.field_operations;
CREATE TRIGGER trg_sync_operation_to_fdh AFTER INSERT OR UPDATE ON operations_center.field_operations
  FOR EACH ROW EXECUTE FUNCTION farm_overlay.fn_sync_operation_from_legacy();
DROP TRIGGER IF EXISTS trg_sync_opx_to_fdh ON operations_center.field_operation_products;
CREATE TRIGGER trg_sync_opx_to_fdh AFTER INSERT OR UPDATE ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION farm_overlay.fn_sync_operation_product_from_legacy();
-- =============================================================================
