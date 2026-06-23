-- =============================================================================
-- Farm Data Hub — Track 2  OPS/PRODUCTS cost-editing overlay  (farm_overlay)
-- The app EDITS operations/products (cost-line totals, category overrides, carrier
-- flags, soft-deletes, application names, price-unit defaults). fdh core models only
-- the JD AGRONOMIC TRUTH and is YieldStack-bound. Per decision (2026-06): the FDH-only
-- edit layer lives in farm_overlay and NEVER flows to YieldStack. 1:1 sidecars to fdh
-- core rows; the reverse adapter views COALESCE(overlay, core) to rebuild legacy shapes.
-- IDEMPOTENT (IF NOT EXISTS / DROP POLICY IF EXISTS). Prices already in farm_overlay.product_price.
--
-- NOTE: operation_edit also carries the raw JD fields fdh core normalizes/drops (crop_season,
-- crop_name, start_date, end_date, machine_vin, map_image_*) so the reverse view reconstructs
-- field_operations EXACTLY. operation_product_edit value cols are double precision and the
-- *_variable flags are text, matching legacy operations_center.field_operation_products.
-- =============================================================================

-- operation_edit : 1:1 with fdh.operation  (editable field_operations cols + raw-JD reconstruction cols)
CREATE TABLE IF NOT EXISTS farm_overlay.operation_edit (
  operation_edit_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id                 uuid NOT NULL UNIQUE REFERENCES fdh.operation(operation_id) ON DELETE CASCADE,
  grower_id                    uuid NOT NULL,
  application_name             text,
  application_name_jd_original text,
  application_name_user_edited boolean NOT NULL DEFAULT false,
  crop_name_override           text,
  measurement_status           text,
  crop_season                  text,
  crop_name                    text,
  start_date                   timestamptz,
  end_date                     timestamptz,
  machine_vin                  text,
  map_image_path               text,
  map_image_extent             jsonb,
  map_image_legends            jsonb,
  date_created                 timestamptz NOT NULL DEFAULT now(),
  date_modified                timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid,
  modified_by                  uuid
);

-- operation_product_edit : 1:1 with fdh.operation_product  (cost-line edit surface; COST MATH USES total_value)
CREATE TABLE IF NOT EXISTS farm_overlay.operation_product_edit (
  operation_product_edit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_product_id      uuid NOT NULL UNIQUE REFERENCES fdh.operation_product(operation_product_id) ON DELETE CASCADE,
  product_category_override text,
  is_carrier                boolean NOT NULL DEFAULT false,
  rate_value                double precision,
  rate_unit                 text,
  rate_variable             text,
  total_value               double precision,
  total_unit                text,
  total_variable            text,
  area_value                double precision,
  area_unit                 text,
  is_user_edited            boolean NOT NULL DEFAULT false,
  edited_at                 timestamptz,
  deleted_at                timestamptz,
  date_created              timestamptz NOT NULL DEFAULT now(),
  date_modified             timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  modified_by               uuid
);

-- product_meta : 1:1 with fdh.product  (FDH cost-display metadata; density+nutrient stay in fdh core)
CREATE TABLE IF NOT EXISTS farm_overlay.product_meta (
  product_meta_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              uuid NOT NULL UNIQUE REFERENCES fdh.product(product_id) ON DELETE CASCADE,
  product_category        text,
  product_category_source text,
  default_unit            text,
  price_unit_default      text,
  is_carrier_default      boolean NOT NULL DEFAULT false,
  name_normalized         text,
  product_kind            text,
  date_created            timestamptz NOT NULL DEFAULT now(),
  date_modified           timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  modified_by             uuid
);

ALTER TABLE farm_overlay.operation_edit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_overlay.operation_product_edit ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_overlay.product_meta           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_all ON farm_overlay.operation_edit;
CREATE POLICY operator_all ON farm_overlay.operation_edit FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());
DROP POLICY IF EXISTS operator_all ON farm_overlay.operation_product_edit;
CREATE POLICY operator_all ON farm_overlay.operation_product_edit FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());
DROP POLICY IF EXISTS operator_all ON farm_overlay.product_meta;
CREATE POLICY operator_all ON farm_overlay.product_meta FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());

GRANT SELECT, INSERT, UPDATE, DELETE ON farm_overlay.operation_edit, farm_overlay.operation_product_edit, farm_overlay.product_meta TO authenticated;
GRANT ALL ON farm_overlay.operation_edit, farm_overlay.operation_product_edit, farm_overlay.product_meta TO service_role;

CREATE INDEX IF NOT EXISTS idx_op_edit_grower ON farm_overlay.operation_edit (grower_id);
CREATE INDEX IF NOT EXISTS idx_opedit_deleted ON farm_overlay.operation_product_edit (deleted_at) WHERE deleted_at IS NOT NULL;
-- Data backfill (one-time, prod) lives in docs/migration as a record — no-op on a fresh DB.
-- =============================================================================
