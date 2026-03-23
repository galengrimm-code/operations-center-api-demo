/*
  # Add raw_response column to fields table for debugging

  1. Modified Tables
    - `fields`
      - Added `raw_response` (jsonb, nullable) - stores the complete raw JSON object
        returned by the John Deere API for each field, to aid in debugging
        boundary parsing issues.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'raw_response'
  ) THEN
    ALTER TABLE fields ADD COLUMN raw_response jsonb;
  END IF;
END $$;
