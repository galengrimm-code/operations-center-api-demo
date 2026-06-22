-- =============================================================================
-- Farm Data Hub — Track 2 WRITE SYNC  operations_center.fields -> fdh
-- Closes the fields footgun: the map now READS fdh (via operations_center.fdh_fields),
-- but the JD import WRITER still upserts the flat operations_center.fields table.
-- This AFTER trigger decomposes each written legacy field row into the fdh graph
-- (grower / farm / field / active boundary / center-pivot irrigation) so a re-import
-- (or the irrigation_start_year edit) propagates to fdh automatically — no app change.
--
-- Mirrors the validated decomposition in 02_fdh_data_migration.sql (blocks 1-5) but
-- with UPSERT/UPDATE/DEACTIVATE semantics (a re-import can change OR remove a boundary,
-- rename a field, or reassign client/farm) instead of the migration's insert-only DO NOTHING.
--
-- Codex-reviewed 2026-06-16. Incorporated: cross-grower reassignment guard (no dup rows),
-- boundary/irrigation DEACTIVATION on removal (no stale geometry in the read view),
-- selective re-raise of STRUCTURAL errors (fail loud on real bugs, fail-open only on bad
-- row data), one-system/one-active-coverage uniqueness guards, pg_catalog-first search_path.
--
-- FAIL-OPEN (data errors only): a bad-row error RAISEs a WARNING and returns — never aborts
-- the legacy upsert. operations_center.fields stays the durable record. STRUCTURAL errors
-- (unique/FK/not-null/privilege/undefined object/function) RE-RAISE so a real defect surfaces
-- loudly instead of silently leaving fdh (the read path) stale.
-- Reversible: DROP TRIGGER trg_sync_field_to_fdh ON operations_center.fields;
--             DROP FUNCTION fdh.fn_sync_field_from_legacy();
-- =============================================================================

-- One-pivot-per-field / one-active-coverage-per-system guardrails (verified: existing
-- data has 0 violations). Make the trigger's "reuse the field's system" assumption real.
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_irrigation_field
  ON fdh.field_irrigation (field_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_irrcov_active_per_system
  ON fdh.irrigation_coverage (irrigation_system_id) WHERE is_active;

CREATE OR REPLACE FUNCTION fdh.fn_sync_field_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fdh, extensions
AS $$
DECLARE
  v_grower_id uuid;
  v_farm_id   uuid;
  v_field_id  uuid;
  v_cp        uuid;
  v_sys       uuid;
  v_geom      extensions.geometry;
  v_irr_geom  extensions.geometry;
BEGIN
  -- Need the full client -> farm -> field hierarchy to place a field in fdh.
  -- Skip (leave to a later full migration) rows missing any anchor.
  IF NEW.client_name IS NULL OR NEW.farm_name IS NULL OR NEW.jd_field_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. GROWER (upsert by name; keep existing external_ref if already set)
  INSERT INTO fdh.grower (grower_name, external_ref)
    VALUES (NEW.client_name, NEW.client_id)
    ON CONFLICT (grower_name)
      DO UPDATE SET external_ref = COALESCE(fdh.grower.external_ref, EXCLUDED.external_ref)
    RETURNING grower_id INTO v_grower_id;

  -- GUARD (Codex P1): the JD field already exists under a DIFFERENT grower — i.e. its
  -- client was reassigned in John Deere. Upserting on (grower_id, external_ref) would
  -- INSERT a duplicate fdh.field and the read view would return both the stale and the
  -- new row for one JD field. Don't write wrong data: flag for manual re-migration and
  -- keep the existing rows. (A farm-only change keeps the same grower and is handled
  -- correctly by the field upsert below.)
  PERFORM 1 FROM fdh.field
    WHERE external_ref = NEW.jd_field_id AND grower_id <> v_grower_id;
  IF FOUND THEN
    RAISE WARNING 'fdh sync: jd_field_id=% reassigned to client "%" — needs manual fdh re-migration (skipped to avoid duplicate)',
      NEW.jd_field_id, NEW.client_name;
    RETURN NEW;
  END IF;

  -- 2. FARM (upsert by grower + name)
  INSERT INTO fdh.farm (grower_id, farm_name, external_ref)
    VALUES (v_grower_id, NEW.farm_name, NEW.farm_id)
    ON CONFLICT (grower_id, farm_name)
      DO UPDATE SET external_ref = COALESCE(fdh.farm.external_ref, EXCLUDED.external_ref)
    RETURNING farm_id INTO v_farm_id;

  -- 3. FIELD (upsert by grower + external_ref; refresh farm/name/org/irr-year on re-import)
  INSERT INTO fdh.field
      (farm_id, grower_id, field_name, external_ref, external_org_ref, irrigation_start_year, source_type)
    VALUES
      (v_farm_id, v_grower_id, NEW.name, NEW.jd_field_id, NEW.org_id, NEW.irrigation_start_year, 'jdops')
    ON CONFLICT (grower_id, external_ref)
      DO UPDATE SET
        farm_id               = EXCLUDED.farm_id,
        field_name            = EXCLUDED.field_name,
        external_org_ref      = EXCLUDED.external_org_ref,
        irrigation_start_year = EXCLUDED.irrigation_start_year,
        date_modified         = now()
    RETURNING field_id INTO v_field_id;

  -- 4. ACTIVE BOUNDARY (one active per field; acres recomputed by fdh.fn_set_acres trigger).
  IF NEW.boundary_geojson IS NOT NULL THEN
    v_geom := extensions.ST_Multi(
                extensions.ST_SetSRID(
                  extensions.ST_GeomFromGeoJSON(NEW.boundary_geojson::text), 4326));
    UPDATE fdh.field_boundary
       SET geom = v_geom, is_active = true
     WHERE field_id = v_field_id AND purpose = 'active';
    IF NOT FOUND THEN
      INSERT INTO fdh.field_boundary (field_id, grower_id, geom, is_active, purpose, source)
        VALUES (v_field_id, v_grower_id, v_geom, true, 'active', 'jdops');
    END IF;
  ELSE
    -- (Codex P1) field lost its boundary in JD: deactivate the stale active row so the
    -- read view (joins WHERE is_active) stops returning stale geometry.
    UPDATE fdh.field_boundary
       SET is_active = false
     WHERE field_id = v_field_id AND purpose = 'active' AND is_active;
  END IF;

  -- 5. IRRIGATION (center-pivot coverage). Reuse the field's existing system if present.
  IF NEW.has_irrigated_boundary AND NEW.irrigated_boundary_geojson IS NOT NULL THEN
    v_irr_geom := extensions.ST_Multi(
                    extensions.ST_SetSRID(
                      extensions.ST_GeomFromGeoJSON(NEW.irrigated_boundary_geojson::text), 4326));
    SELECT fi.irrigation_system_id INTO v_sys
      FROM fdh.field_irrigation fi WHERE fi.field_id = v_field_id LIMIT 1;
    IF v_sys IS NULL THEN
      SELECT irrigation_system_type_id INTO v_cp
        FROM fdh.irrigation_system_type WHERE code = 'center_pivot';
      INSERT INTO fdh.irrigation_system (grower_id, irrigation_system_type_id, name)
        VALUES (v_grower_id, v_cp, NEW.name || ' pivot') RETURNING irrigation_system_id INTO v_sys;
      INSERT INTO fdh.field_irrigation (field_id, irrigation_system_id) VALUES (v_field_id, v_sys);
      INSERT INTO fdh.irrigation_coverage (irrigation_system_id, geom, is_active)
        VALUES (v_sys, v_irr_geom, true);
    ELSE
      -- (Codex P2) update the active coverage; if there is none, insert one.
      UPDATE fdh.irrigation_coverage
         SET geom = v_irr_geom, is_active = true
       WHERE irrigation_system_id = v_sys AND is_active;
      IF NOT FOUND THEN
        INSERT INTO fdh.irrigation_coverage (irrigation_system_id, geom, is_active)
          VALUES (v_sys, v_irr_geom, true);
      END IF;
    END IF;
  ELSE
    -- (Codex P1) field lost its irrigated boundary: deactivate stale coverage so the view
    -- stops reporting has_irrigated_boundary=true / stale irrigated geometry.
    UPDATE fdh.irrigation_coverage
       SET is_active = false
     WHERE is_active
       AND irrigation_system_id IN (SELECT irrigation_system_id FROM fdh.field_irrigation WHERE field_id = v_field_id);
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- (Codex P2) STRUCTURAL / config errors mean a real defect, not bad row data — fail loud
  -- so it surfaces instead of silently leaving fdh (the read path) stale. Everything else
  -- (e.g. one malformed GeoJSON) fails open: warn + let the legacy upsert stand.
  IF SQLSTATE = ANY (ARRAY['23502','23503','23505','42501','42703','42883','42P01']) THEN
    RAISE;
  END IF;
  RAISE WARNING 'fdh field-sync skipped for jd_field_id=% : % (%)', NEW.jd_field_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_field_to_fdh ON operations_center.fields;
CREATE TRIGGER trg_sync_field_to_fdh
  AFTER INSERT OR UPDATE ON operations_center.fields
  FOR EACH ROW EXECUTE FUNCTION fdh.fn_sync_field_from_legacy();
-- =============================================================================
