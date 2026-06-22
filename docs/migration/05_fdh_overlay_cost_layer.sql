-- =============================================================================
-- Farm Data Hub — Track 2  OPS/PRODUCTS cost-editing overlay  (farm_overlay)
-- The app EDITS operations/products (cost-line totals, category overrides, carrier
-- flags, soft-deletes, application names, price-unit defaults). fdh core models only
-- the JD AGRONOMIC TRUTH (operation, operation_product, product) and is YieldStack-
-- bound. Per decision (2026-06-16): the FDH-only edit layer lives in farm_overlay and
-- NEVER flows to YieldStack. These are 1:1 sidecars to the fdh core rows; the reverse
-- adapter views COALESCE(overlay, core) to reconstruct the legacy flat shapes.
-- Additive + reversible (DROP TABLE). Prices already live in farm_overlay.product_price.
-- =============================================================================

-- operation_edit : 1:1 with fdh.operation  (mirrors editable cols on field_operations)
CREATE TABLE IF NOT EXISTS farm_overlay.operation_edit (
  operation_edit_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id                 uuid NOT NULL UNIQUE REFERENCES fdh.operation(operation_id) ON DELETE CASCADE,
  grower_id                    uuid NOT NULL,
  application_name             text,
  application_name_jd_original text,
  application_name_user_edited boolean NOT NULL DEFAULT false,
  crop_name_override           text,           -- JD crop code override (e.g. CORN_WET->SOYBEANS)
  measurement_status           text,           -- JD measurement fetch state (available|not_found|error|unknown)
  date_created                 timestamptz NOT NULL DEFAULT now(),
  date_modified                timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid,
  modified_by                  uuid
);

-- operation_product_edit : 1:1 with fdh.operation_product  (the cost-line edit surface;
-- COST MATH USES total_value). JD originals stay in fdh.operation_product.jd_original.
CREATE TABLE IF NOT EXISTS farm_overlay.operation_product_edit (
  operation_product_edit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_product_id      uuid NOT NULL UNIQUE REFERENCES fdh.operation_product(operation_product_id) ON DELETE CASCADE,
  product_category_override text,
  is_carrier                boolean NOT NULL DEFAULT false,
  rate_value                numeric,
  rate_unit                 text,
  rate_variable             boolean,
  total_value               numeric,
  total_unit                text,
  total_variable            boolean,
  area_value                numeric,
  area_unit                 text,
  is_user_edited            boolean NOT NULL DEFAULT false,
  edited_at                 timestamptz,
  deleted_at                timestamptz,        -- soft-delete for re-import merge
  date_created              timestamptz NOT NULL DEFAULT now(),
  date_modified             timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  modified_by               uuid
);

-- product_meta : 1:1 with fdh.product  (FDH cost-display metadata on products;
-- density + nutrient stay in fdh core as agronomic product properties).
CREATE TABLE IF NOT EXISTS farm_overlay.product_meta (
  product_meta_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              uuid NOT NULL UNIQUE REFERENCES fdh.product(product_id) ON DELETE CASCADE,
  product_category        text,                 -- effective/overridden category
  product_category_source text,                 -- 'seed-pattern' | 'user'
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

-- RLS: same operator-allowlist model as fdh core (single-operator).
ALTER TABLE farm_overlay.operation_edit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_overlay.operation_product_edit ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_overlay.product_meta           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_all ON farm_overlay.operation_edit;
CREATE POLICY operator_all ON farm_overlay.operation_edit
  FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());
DROP POLICY IF EXISTS operator_all ON farm_overlay.operation_product_edit;
CREATE POLICY operator_all ON farm_overlay.operation_product_edit
  FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());
DROP POLICY IF EXISTS operator_all ON farm_overlay.product_meta;
CREATE POLICY operator_all ON farm_overlay.product_meta
  FOR ALL TO authenticated USING (fdh.is_operator()) WITH CHECK (fdh.is_operator());

GRANT SELECT, INSERT, UPDATE, DELETE ON farm_overlay.operation_edit, farm_overlay.operation_product_edit, farm_overlay.product_meta TO authenticated;
GRANT ALL ON farm_overlay.operation_edit, farm_overlay.operation_product_edit, farm_overlay.product_meta TO service_role;

CREATE INDEX IF NOT EXISTS idx_op_edit_grower    ON farm_overlay.operation_edit (grower_id);
CREATE INDEX IF NOT EXISTS idx_opedit_deleted    ON farm_overlay.operation_product_edit (deleted_at) WHERE deleted_at IS NOT NULL;
-- =============================================================================
