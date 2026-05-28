-- 20260528120000_create_products_table.sql
-- Creates the catalog of unique John Deere products per (user, org), populated by
-- import-applications. Future cost layer (product_price_events) joins on products.id.
-- See docs/superpowers/specs/2026-05-28-spray-application-sync-design.md section 4.1.

BEGIN;

CREATE TABLE operations_center.products (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                   text NOT NULL,
  jd_product_id            text NOT NULL,
  name                     text NOT NULL,
  name_normalized          text NOT NULL,
  brand                    text,
  is_carrier_default       boolean NOT NULL DEFAULT false,
  product_kind             text,
  product_category         text,
  product_category_source  text,
  default_unit             text,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  raw_response             jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_jd_uniq UNIQUE (user_id, org_id, jd_product_id)
);

CREATE INDEX products_user_org_idx ON operations_center.products (user_id, org_id);
CREATE INDEX products_name_normalized_idx ON operations_center.products (user_id, org_id, name_normalized);
CREATE INDEX products_category_idx ON operations_center.products (user_id, org_id, product_category);

ALTER TABLE operations_center.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select_products" ON operations_center.products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_products" ON operations_center.products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_products" ON operations_center.products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_products" ON operations_center.products
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.products TO authenticated;
GRANT ALL ON operations_center.products TO service_role;

COMMIT;
