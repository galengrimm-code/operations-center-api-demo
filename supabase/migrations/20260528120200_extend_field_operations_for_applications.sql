-- 20260528120200_extend_field_operations_for_applications.sql
-- Adds three columns to existing field_operations table:
-- - measurement_status: tracks whether the JD measurement endpoint returned data (Phase 0c finding: 404s are normal)
-- - application_name: the editable tank-mix recipe name surfaced in UI
-- - application_name_jd_original + application_name_user_edited: revert support
-- See spec section 4.1.

BEGIN;

ALTER TABLE operations_center.field_operations
  ADD COLUMN measurement_status text NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN operations_center.field_operations.measurement_status IS
  'available | not_found | error | unknown — JD measurement fetch state';

ALTER TABLE operations_center.field_operations
  ADD COLUMN application_name text,
  ADD COLUMN application_name_jd_original text,
  ADD COLUMN application_name_user_edited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN operations_center.field_operations.application_name IS
  'Editable tank-mix recipe label (e.g., "Infurrow", "Corn Blend"). Derived from JD outer ApplicationProductTotal.name on import.';

CREATE INDEX field_operations_measurement_status_idx
  ON operations_center.field_operations (user_id, org_id, measurement_status)
  WHERE measurement_status IN ('not_found', 'error');

COMMIT;
