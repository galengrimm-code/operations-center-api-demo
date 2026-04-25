-- Per-operation crop name override.
-- Pre-2023 JD didn't distinguish amylose corn from regular corn — both came
-- through as CORN_WET. Lets the user retroactively reclassify a specific
-- harvest operation (e.g., "Jones 2022 was actually amylose"). NULL means
-- use the original crop_name from JD.

ALTER TABLE operations_center.field_operations
  ADD COLUMN IF NOT EXISTS crop_name_override text;
