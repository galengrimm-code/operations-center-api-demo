-- Two per-product pricing aids (both additive, nullable):
-- 1. nutrient_content_pct: when JD records the APPLIED amount as a nutrient (e.g. lb of N)
--    but the product is PRICED as total product (e.g. $/ton of NH3, which is 82% N), this is
--    the % of the priced product that the applied substance represents. Null = 100% (applied
--    IS the product, no adjustment). Cost math divides the converted amount by (pct/100).
-- 2. price_unit_default: the preferred pricing unit for this product (e.g. "ton" for fertilizer,
--    "gal" for liquid chemical), used as the price picker's default + settable in bulk by category.
alter table operations_center.products
  add column if not exists nutrient_content_pct numeric
    check (nutrient_content_pct is null or (nutrient_content_pct > 0 and nutrient_content_pct <= 100));

alter table operations_center.products
  add column if not exists price_unit_default text
    check (price_unit_default is null or price_unit_default in ('ozm','lb','ton','floz','pt','qt','gal'));
