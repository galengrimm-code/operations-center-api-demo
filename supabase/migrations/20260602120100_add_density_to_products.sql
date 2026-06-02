-- Physical constant per product; powers weight<->volume cost conversion.
-- Null = product never crosses unit families (priced & applied in the same family).
alter table operations_center.products
  add column if not exists density_lbs_per_gal numeric check (density_lbs_per_gal is null or density_lbs_per_gal > 0);
