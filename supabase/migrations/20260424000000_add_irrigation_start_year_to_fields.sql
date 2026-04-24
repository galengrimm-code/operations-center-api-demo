-- Add irrigation_start_year column to operations_center.fields.
-- Marks the first crop season a field had irrigation. Operations with
-- crop_season earlier than this year are treated as 100% dryland in reports
-- regardless of the current irrigated boundary. NULL = no override
-- (use current irrigated boundary for all years).

ALTER TABLE operations_center.fields
  ADD COLUMN IF NOT EXISTS irrigation_start_year integer;
