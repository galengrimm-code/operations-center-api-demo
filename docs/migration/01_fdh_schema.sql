-- =============================================================================
-- Farm Data Hub — schema `fdh` (v7-derived) + `farm_overlay`
-- Target project: nuxofsjzrgdauzriraze (SHARED with Farm Budget — additive only).
-- Rev 2 (post-Codex review): composite-FK grower chain closed end-to-end;
--   column-list ON DELETE SET NULL; operator-allowlist RLS (shared-auth safe);
--   acres maintained by trigger (no generated-column immutability gamble);
--   sequence grants completed; anon grant dropped.
-- Refinements: R1 external_ref (JD ids); R2 operation summary cols;
--   R3 user-edit preservation; R4 grower_id integrity (composite FKs);
--   R5 file_hash UNIQUE per grower; R6 audit fn invoker; R7 RLS operator-scoped.
-- SAFETY: every object schema-qualified. No DROP/DELETE. Confirm project ref first.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS fdh;
CREATE SCHEMA IF NOT EXISTS farm_overlay;

CREATE EXTENSION IF NOT EXISTS postgis  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

SET search_path = fdh, extensions, public;

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fdh.fn_audit_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.date_created := now(); NEW.date_modified := now();
    NEW.created_by := auth.uid(); NEW.modified_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.date_modified := now(); NEW.modified_by := auth.uid();
    NEW.date_created := OLD.date_created; NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END $$;

-- acres maintained here (NOT a generated column — avoids ST_Area immutability risk)
CREATE OR REPLACE FUNCTION fdh.fn_set_acres()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = extensions AS $$
BEGIN
  NEW.acres := CASE WHEN NEW.geom IS NULL THEN NULL
                    ELSE ST_Area(NEW.geom::geography) / 4046.8564224 END;
  RETURN NEW;
END $$;

-- operator allowlist check (SECURITY DEFINER so the policy subquery bypasses RLS)
CREATE TABLE fdh.operator (
  user_id UUID PRIMARY KEY,
  note TEXT,
  added_at TIMESTAMPTZ DEFAULT now()
);
CREATE OR REPLACE FUNCTION fdh.is_operator()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fdh AS $$
  SELECT EXISTS (SELECT 1 FROM fdh.operator WHERE user_id = auth.uid());
$$;

-- =============================================================================
-- LOOKUPS
-- =============================================================================
CREATE TABLE fdh.crop (
  crop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_name TEXT NOT NULL UNIQUE,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.crop_subtype (
  crop_subtype_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_id UUID NOT NULL REFERENCES fdh.crop(crop_id) ON DELETE CASCADE,
  subtype_name TEXT NOT NULL, external_ref TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (crop_id, subtype_name)
);
CREATE TABLE fdh.uom (
  uom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, dimension TEXT NOT NULL,
  requires_density BOOLEAN NOT NULL DEFAULT false,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.uom_conversion (
  uom_conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uom_id UUID NOT NULL REFERENCES fdh.uom(uom_id) ON DELETE CASCADE,
  to_uom_id   UUID NOT NULL REFERENCES fdh.uom(uom_id) ON DELETE CASCADE,
  factor NUMERIC NOT NULL, requires_density BOOLEAN NOT NULL DEFAULT false,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (from_uom_id, to_uom_id)
);
CREATE TABLE fdh.ddi (
  ddi_id INTEGER PRIMARY KEY, name TEXT NOT NULL, definition TEXT,
  default_uom_id UUID REFERENCES fdh.uom(uom_id),
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.operation_type (
  operation_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.irrigation_system_type (
  irrigation_system_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);

-- =============================================================================
-- HIERARCHY  grower -> farm -> field -> field_boundary -> field_crop_year
-- =============================================================================
CREATE TABLE fdh.grower (
  grower_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_name TEXT NOT NULL UNIQUE, external_ref TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.farm (
  farm_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id) ON DELETE CASCADE,
  farm_name TEXT NOT NULL, external_ref TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  UNIQUE (grower_id, farm_name),
  UNIQUE (farm_id, grower_id)                     -- composite-FK target (chain top)
);
CREATE TABLE fdh.field (
  field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL,
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_name TEXT NOT NULL, external_ref TEXT, source_type TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  FOREIGN KEY (farm_id, grower_id) REFERENCES fdh.farm(farm_id, grower_id) ON DELETE CASCADE,
  UNIQUE (farm_id, field_name),
  UNIQUE (field_id, grower_id),
  UNIQUE (grower_id, external_ref)
);
CREATE TABLE fdh.field_boundary (
  field_boundary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL, grower_id UUID NOT NULL,
  geom geometry(MULTIPOLYGON, 4326) NOT NULL,
  season INTEGER, valid_from DATE, valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true, purpose TEXT, source TEXT,
  acres NUMERIC,                                  -- maintained by fn_set_acres trigger
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  FOREIGN KEY (field_id, grower_id) REFERENCES fdh.field(field_id, grower_id) ON DELETE CASCADE
);
CREATE TABLE fdh.field_crop_year (
  field_crop_year_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL, grower_id UUID NOT NULL, season INTEGER NOT NULL,
  crop_id UUID REFERENCES fdh.crop(crop_id),
  crop_subtype_id UUID REFERENCES fdh.crop_subtype(crop_subtype_id),
  destination TEXT, land_use_status TEXT NOT NULL DEFAULT 'cash_crop',
  geom geometry(MULTIPOLYGON, 4326), acres NUMERIC,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  FOREIGN KEY (field_id, grower_id) REFERENCES fdh.field(field_id, grower_id) ON DELETE CASCADE,
  UNIQUE (field_crop_year_id, grower_id)
);

-- =============================================================================
-- PRODUCT CATALOG
-- =============================================================================
CREATE TABLE fdh.product_concept (
  product_concept_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, category TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.product (
  product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_concept_id UUID NOT NULL REFERENCES fdh.product_concept(product_concept_id) ON DELETE RESTRICT,
  grower_id UUID REFERENCES fdh.grower(grower_id),
  brand TEXT, valid_from DATE, valid_to DATE,
  density NUMERIC, density_uom_id UUID REFERENCES fdh.uom(uom_id),
  external_ref TEXT, external_cost_ref TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE UNIQUE INDEX uq_product_ext ON fdh.product (external_ref) WHERE external_ref IS NOT NULL;
CREATE TABLE fdh.product_nutrient (
  product_nutrient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES fdh.product(product_id) ON DELETE CASCADE,
  nutrient TEXT NOT NULL, pct NUMERIC NOT NULL, basis TEXT NOT NULL DEFAULT 'oxide',
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (product_id, nutrient, basis)
);

-- =============================================================================
-- DEVICES
-- =============================================================================
CREATE TABLE fdh.device (
  device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID REFERENCES fdh.grower(grower_id),
  name TEXT NOT NULL, device_type TEXT, external_ref TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.device_element (
  device_element_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES fdh.device(device_id) ON DELETE CASCADE,
  parent_element_id UUID REFERENCES fdh.device_element(device_element_id) ON DELETE CASCADE,
  element_type TEXT NOT NULL, element_number INTEGER, name TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);

-- =============================================================================
-- OPERATIONS + DENSE LOG
-- =============================================================================
CREATE TABLE fdh.operation (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),   -- direct (composite below is nullable)
  field_id UUID, field_crop_year_id UUID,
  operation_type_id UUID NOT NULL REFERENCES fdh.operation_type(operation_type_id),
  device_id UUID REFERENCES fdh.device(device_id),
  operation_date DATE, season INTEGER, source_type TEXT, external_ref TEXT,
  data_import_id UUID,
  avg_yield_value NUMERIC, avg_yield_uom_id UUID REFERENCES fdh.uom(uom_id),
  avg_moisture NUMERIC,
  total_mass_value NUMERIC, total_mass_uom_id UUID REFERENCES fdh.uom(uom_id),
  area_value NUMERIC, area_uom_id UUID REFERENCES fdh.uom(uom_id),
  variety_name TEXT, machine_name TEXT, notes TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  UNIQUE (operation_id, grower_id),
  UNIQUE (grower_id, external_ref),
  FOREIGN KEY (field_id, grower_id)
    REFERENCES fdh.field(field_id, grower_id) ON DELETE SET NULL (field_id),
  FOREIGN KEY (field_crop_year_id, grower_id)
    REFERENCES fdh.field_crop_year(field_crop_year_id, grower_id) ON DELETE SET NULL (field_crop_year_id)
);
CREATE TABLE fdh.operation_channel (
  operation_channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES fdh.operation(operation_id) ON DELETE CASCADE,
  ddi_id INTEGER REFERENCES fdh.ddi(ddi_id),
  product_id UUID REFERENCES fdh.product(product_id),
  device_element_id UUID REFERENCES fdh.device_element(device_element_id),
  uom_id UUID REFERENCES fdh.uom(uom_id),
  channel_name TEXT NOT NULL, description TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.operation_point (
  operation_point_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id UUID NOT NULL, grower_id UUID NOT NULL,
  field_crop_year_id UUID, year INTEGER,
  geom geometry(POINT, 4326) NOT NULL, recorded_at TIMESTAMPTZ, gps_date DATE,
  heading NUMERIC, speed NUMERIC, distance NUMERIC, elevation NUMERIC,
  swath_width NUMERIC, pass_num INTEGER,
  attributes JSONB, source_type TEXT, data_import_id UUID,
  FOREIGN KEY (operation_id, grower_id)
    REFERENCES fdh.operation(operation_id, grower_id) ON DELETE CASCADE,
  FOREIGN KEY (field_crop_year_id, grower_id)
    REFERENCES fdh.field_crop_year(field_crop_year_id, grower_id) ON DELETE SET NULL (field_crop_year_id)
);
CREATE TABLE fdh.operation_point_value (
  operation_point_id BIGINT NOT NULL REFERENCES fdh.operation_point(operation_point_id) ON DELETE CASCADE,
  operation_channel_id UUID NOT NULL REFERENCES fdh.operation_channel(operation_channel_id) ON DELETE CASCADE,
  value NUMERIC, value_text TEXT,
  PRIMARY KEY (operation_point_id, operation_channel_id)
);
CREATE TABLE fdh.operation_product (
  operation_product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES fdh.operation(operation_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES fdh.product(product_id),
  line_index INTEGER,
  total_amount NUMERIC, uom_id UUID REFERENCES fdh.uom(uom_id),
  area_covered_acres NUMERIC, avg_rate NUMERIC,
  is_user_edited BOOLEAN NOT NULL DEFAULT false, edited_at TIMESTAMPTZ, jd_original JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID,
  UNIQUE (operation_id, line_index)
);

-- =============================================================================
-- IRRIGATION
-- =============================================================================
CREATE TABLE fdh.irrigation_system (
  irrigation_system_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  irrigation_system_type_id UUID REFERENCES fdh.irrigation_system_type(irrigation_system_type_id),
  name TEXT, pivot_point geometry(POINT, 4326), radius_m NUMERIC,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.irrigation_coverage (
  irrigation_coverage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  irrigation_system_id UUID NOT NULL REFERENCES fdh.irrigation_system(irrigation_system_id) ON DELETE CASCADE,
  geom geometry(MULTIPOLYGON, 4326) NOT NULL,
  season INTEGER, valid_from DATE, valid_to DATE, is_active BOOLEAN NOT NULL DEFAULT true,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.field_irrigation (
  field_id UUID NOT NULL REFERENCES fdh.field(field_id) ON DELETE CASCADE,
  irrigation_system_id UUID NOT NULL REFERENCES fdh.irrigation_system(irrigation_system_id) ON DELETE CASCADE,
  PRIMARY KEY (field_id, irrigation_system_id)
);

-- =============================================================================
-- VECTOR FEATURES
-- =============================================================================
CREATE TABLE fdh.feature_layer (
  feature_layer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_id UUID REFERENCES fdh.field(field_id) ON DELETE SET NULL,
  layer_type TEXT NOT NULL, name TEXT, season INTEGER, valid_from DATE, valid_to DATE,
  source TEXT, data_import_id UUID,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.feature (
  feature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_layer_id UUID NOT NULL REFERENCES fdh.feature_layer(feature_layer_id) ON DELETE CASCADE,
  geom geometry(MULTIPOLYGON, 4326) NOT NULL, label TEXT, attributes JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);

-- =============================================================================
-- SAMPLE POINTS
-- =============================================================================
CREATE TABLE fdh.observation_unit (
  observation_unit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_id UUID REFERENCES fdh.field(field_id) ON DELETE SET NULL,
  geom geometry(POINT, 4326) NOT NULL, radius_m NUMERIC DEFAULT 15.24,
  label TEXT, notes TEXT, source TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.sample_set (
  sample_set_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  name TEXT NOT NULL, description TEXT, season INTEGER,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.sample_set_member (
  sample_set_id UUID NOT NULL REFERENCES fdh.sample_set(sample_set_id) ON DELETE CASCADE,
  observation_unit_id UUID NOT NULL REFERENCES fdh.observation_unit(observation_unit_id) ON DELETE CASCADE,
  treatment_label TEXT, PRIMARY KEY (sample_set_id, observation_unit_id)
);

-- =============================================================================
-- SPARSE / EXTERNAL COVARIATES
-- =============================================================================
CREATE TABLE fdh.soil_sample (
  soil_sample_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_id UUID REFERENCES fdh.field(field_id) ON DELETE SET NULL,
  field_crop_year_id UUID REFERENCES fdh.field_crop_year(field_crop_year_id) ON DELETE SET NULL,
  sample_date DATE, sampled_by TEXT, lab TEXT,
  geom geometry(POINT, 4326), gps_timestamp TIMESTAMPTZ,
  ph NUMERIC, buffer_ph NUMERIC, organic_matter NUMERIC, cec NUMERIC,
  p NUMERIC, k NUMERIC, ca NUMERIC, mg NUMERIC, s NUMERIC,
  zn NUMERIC, mn NUMERIC, fe NUMERIC, cu NUMERIC, b NUMERIC, nitrate NUMERIC, na NUMERIC,
  base_saturation NUMERIC, pct_h NUMERIC, pct_ca NUMERIC, pct_mg NUMERIC, pct_k NUMERIC, pct_na NUMERIC,
  metadata JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);
CREATE TABLE fdh.weather_daily (
  weather_daily_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL REFERENCES fdh.field(field_id) ON DELETE CASCADE,
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  wx_date DATE NOT NULL, source_id TEXT,
  tmax_c NUMERIC, tmin_c NUMERIC, precip_mm NUMERIC, gdd NUMERIC, metadata JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (field_id, wx_date, source_id)
);
CREATE TABLE fdh.imagery_scene (
  imagery_scene_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_id UUID REFERENCES fdh.field(field_id) ON DELETE SET NULL,
  source TEXT, scene_date DATE, band TEXT, storage_path TEXT, source_scene_ref TEXT,
  footprint geometry(POLYGON, 4326), resolution_m NUMERIC, is_cached BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID
);

-- =============================================================================
-- OPS
-- =============================================================================
CREATE TABLE fdh.data_import (
  data_import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID REFERENCES fdh.grower(grower_id),
  file_name TEXT, file_hash TEXT, source_type TEXT, status TEXT, row_count INTEGER,
  imported_at TIMESTAMPTZ DEFAULT now(), metadata JSONB,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (grower_id, file_hash)
);
ALTER TABLE fdh.operation       ADD CONSTRAINT fk_operation_import    FOREIGN KEY (data_import_id) REFERENCES fdh.data_import(data_import_id) ON DELETE SET NULL;
ALTER TABLE fdh.operation_point ADD CONSTRAINT fk_oppoint_import      FOREIGN KEY (data_import_id) REFERENCES fdh.data_import(data_import_id) ON DELETE SET NULL;
ALTER TABLE fdh.feature_layer   ADD CONSTRAINT fk_featurelayer_import FOREIGN KEY (data_import_id) REFERENCES fdh.data_import(data_import_id) ON DELETE SET NULL;

-- =============================================================================
-- OVERLAY (private cost + planning; NOT the fdh agronomic core)
-- =============================================================================
CREATE TABLE farm_overlay.product_price (
  product_price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  product_id UUID REFERENCES fdh.product(product_id),
  external_product_ref TEXT, year INTEGER,
  price_per_unit NUMERIC CHECK (price_per_unit >= 0), price_unit TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (grower_id, product_id, year)
);
CREATE TABLE farm_overlay.field_season (
  field_season_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id UUID NOT NULL REFERENCES fdh.grower(grower_id),
  field_id UUID REFERENCES fdh.field(field_id) ON DELETE CASCADE,
  external_field_ref TEXT, season_year INTEGER,
  intended_crop TEXT, intended_acres NUMERIC, planted_date DATE, planted_acres NUMERIC, notes TEXT,
  date_created TIMESTAMPTZ DEFAULT now(), date_modified TIMESTAMPTZ DEFAULT now(),
  created_by UUID, modified_by UUID, UNIQUE (grower_id, field_id, season_year)
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_field_boundary_geom      ON fdh.field_boundary     USING GIST (geom);
CREATE INDEX idx_field_crop_year_geom     ON fdh.field_crop_year    USING GIST (geom);
CREATE INDEX idx_operation_point_geom     ON fdh.operation_point    USING GIST (geom);
CREATE INDEX idx_irrigation_coverage_geom ON fdh.irrigation_coverage USING GIST (geom);
CREATE INDEX idx_feature_geom             ON fdh.feature            USING GIST (geom);
CREATE INDEX idx_observation_unit_geom    ON fdh.observation_unit   USING GIST (geom);
CREATE INDEX idx_soil_sample_geom         ON fdh.soil_sample        USING GIST (geom);
CREATE INDEX idx_imagery_footprint        ON fdh.imagery_scene      USING GIST (footprint);
CREATE INDEX idx_operation_point_recorded ON fdh.operation_point    USING BRIN (recorded_at);
CREATE INDEX idx_farm_grower              ON fdh.farm               (grower_id);
CREATE INDEX idx_field_farm               ON fdh.field              (farm_id);
CREATE INDEX idx_field_grower             ON fdh.field              (grower_id);
CREATE INDEX idx_field_boundary_field     ON fdh.field_boundary     (field_id);
CREATE INDEX idx_fcy_field                ON fdh.field_crop_year    (field_id);
CREATE INDEX idx_fcy_grower_season        ON fdh.field_crop_year    (grower_id, season);
CREATE INDEX idx_operation_fcy            ON fdh.operation          (field_crop_year_id);
CREATE INDEX idx_operation_grower         ON fdh.operation          (grower_id);
CREATE INDEX idx_op_channel_operation     ON fdh.operation_channel  (operation_id);
CREATE INDEX idx_op_channel_product       ON fdh.operation_channel  (product_id);
CREATE INDEX idx_oppoint_operation        ON fdh.operation_point    (operation_id);
CREATE INDEX idx_oppoint_grower           ON fdh.operation_point    (grower_id);
CREATE INDEX idx_opvalue_channel          ON fdh.operation_point_value (operation_channel_id);
CREATE INDEX idx_op_product_operation     ON fdh.operation_product  (operation_id);
CREATE INDEX idx_op_product_product       ON fdh.operation_product  (product_id);
CREATE INDEX idx_device_element_device    ON fdh.device_element     (device_id);
CREATE INDEX idx_feature_layer_fk         ON fdh.feature            (feature_layer_id);
CREATE INDEX idx_soil_sample_field        ON fdh.soil_sample        (field_id);
CREATE INDEX idx_weather_field_date       ON fdh.weather_daily      (field_id, wx_date);
CREATE INDEX idx_overlay_price_product    ON farm_overlay.product_price (product_id);

-- =============================================================================
-- TRIGGERS  (acres + audit)
-- =============================================================================
CREATE TRIGGER trg_field_boundary_acres BEFORE INSERT OR UPDATE OF geom ON fdh.field_boundary
  FOR EACH ROW EXECUTE FUNCTION fdh.fn_set_acres();
CREATE TRIGGER trg_field_crop_year_acres BEFORE INSERT OR UPDATE OF geom ON fdh.field_crop_year
  FOR EACH ROW EXECUTE FUNCTION fdh.fn_set_acres();

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT 'fdh' AS s, x AS t FROM unnest(ARRAY[
      'crop','crop_subtype','uom','uom_conversion','ddi','operation_type',
      'irrigation_system_type','grower','farm','field','field_boundary','field_crop_year',
      'product_concept','product','product_nutrient','device','device_element',
      'operation','operation_channel','operation_product','irrigation_system',
      'irrigation_coverage','feature_layer','feature','observation_unit','sample_set',
      'soil_sample','weather_daily','imagery_scene','data_import']) x
    UNION ALL SELECT 'farm_overlay', x FROM unnest(ARRAY['product_price','field_season']) x
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_audit BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION fdh.fn_audit_stamp();', rec.t, rec.s, rec.t);
  END LOOP;
END $$;

-- =============================================================================
-- RLS  (operator-allowlist; shared-auth safe)
-- =============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('fdh','farm_overlay')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', r.schemaname, r.tablename);
    EXECUTE format($p$CREATE POLICY %I ON %I.%I FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());$p$,
                   r.tablename||'_op', r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Grants (RLS gates rows; only operators pass the policy)
GRANT USAGE ON SCHEMA fdh, farm_overlay TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fdh, farm_overlay TO authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fdh, farm_overlay TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fdh.is_operator() TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fdh, farm_overlay GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fdh, farm_overlay GRANT USAGE ON SEQUENCES TO authenticated, service_role;
-- CONFIG (dashboard, not SQL): API → Exposed schemas → add `fdh, farm_overlay`.

-- =============================================================================
-- SEED
-- =============================================================================
INSERT INTO fdh.operator (user_id, note)
  SELECT user_id, 'seeded from operations_center JD connection'
  FROM operations_center.john_deere_connections
  ON CONFLICT (user_id) DO NOTHING;

INSERT INTO fdh.operation_type (code, name) VALUES
  ('seeding','Seeding/Planting'),('application','Application'),('harvest','Harvest'),
  ('tillage','Tillage'),('ec_survey','EC / Soil Survey'),('sensing','Sensing/Scouting')
ON CONFLICT (code) DO NOTHING;
INSERT INTO fdh.irrigation_system_type (code, name) VALUES
  ('center_pivot','Center Pivot'),('drip','Drip'),('subsurface_drip','Subsurface Drip'),
  ('micro_sprinkler','Micro-sprinkler'),('flood_furrow','Flood/Furrow'),('wheel_line','Wheel Line')
ON CONFLICT (code) DO NOTHING;
INSERT INTO fdh.uom (code, name, dimension, requires_density) VALUES
  ('lb_ac','Pounds per acre','rate_mass_area',false),
  ('gal_ac','Gallons per acre','rate_volume_area',true),
  ('seeds_ac','Seeds per acre','rate_count_area',false),
  ('bu_ac','Bushels per acre','rate_volume_area',false),
  ('ton','Ton','mass',false),('lb','Pound','mass',false),('gal','Gallon','volume',true),
  ('ac','Acre','area',false),('pct','Percent','ratio',false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO fdh.crop (crop_name) VALUES
  ('Corn'),('Soybeans'),('Rye'),('Grass'),('Wheat')
ON CONFLICT (crop_name) DO NOTHING;

COMMIT;
-- =============================================================================
-- DONE (rev 2). Deterministic apply (no generated-column gamble).
-- =============================================================================
