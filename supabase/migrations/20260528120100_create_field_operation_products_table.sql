-- 20260528120100_create_field_operation_products_table.sql
-- Per-product tank-mix line items. The analytics workhorse.
-- See spec section 4.1.

BEGIN;

CREATE TABLE operations_center.field_operation_products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                      text NOT NULL,
  field_operation_id          uuid NOT NULL REFERENCES operations_center.field_operations(id) ON DELETE CASCADE,
  product_id                  uuid NOT NULL REFERENCES operations_center.products(id) ON DELETE RESTRICT,
  line_index                  integer NOT NULL,
  product_category_override   text,
  is_carrier                  boolean NOT NULL DEFAULT false,

  -- Live editable values
  rate_value                  double precision,
  rate_unit                   text,
  rate_variable               text,
  total_value                 double precision,
  total_unit                  text,
  total_variable              text,
  area_value                  double precision,
  area_unit                   text,

  -- JD original values (set on import, never modified by user edits)
  rate_value_jd_original      double precision,
  total_value_jd_original     double precision,
  area_value_jd_original      double precision,

  -- Edit tracking
  is_user_edited              boolean NOT NULL DEFAULT false,
  edited_at                   timestamptz,

  -- Soft-delete for re-import merge
  deleted_at                  timestamptz,

  raw_response                jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fop_line_uniq UNIQUE (field_operation_id, line_index)
);

CREATE INDEX fop_user_org_idx ON operations_center.field_operation_products (user_id, org_id);
CREATE INDEX fop_field_operation_idx ON operations_center.field_operation_products (field_operation_id);
CREATE INDEX fop_product_idx ON operations_center.field_operation_products (product_id);
CREATE INDEX fop_user_org_product_idx ON operations_center.field_operation_products (user_id, org_id, product_id)
  WHERE deleted_at IS NULL;

-- Backup-guard trigger (edge function writes user_id/org_id explicitly; this only fills if null)
CREATE OR REPLACE FUNCTION operations_center.fop_set_user_org_from_field_op()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.org_id IS NULL THEN
    SELECT user_id, org_id INTO NEW.user_id, NEW.org_id
    FROM operations_center.field_operations
    WHERE id = NEW.field_operation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fop_set_user_org_before_insert
  BEFORE INSERT ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION operations_center.fop_set_user_org_from_field_op();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION operations_center.fop_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fop_set_updated_at_before_update
  BEFORE UPDATE ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION operations_center.fop_set_updated_at();

ALTER TABLE operations_center.field_operation_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select_fop" ON operations_center.field_operation_products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_fop" ON operations_center.field_operation_products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_fop" ON operations_center.field_operation_products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_fop" ON operations_center.field_operation_products
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.field_operation_products TO authenticated;
GRANT ALL ON operations_center.field_operation_products TO service_role;

COMMIT;
