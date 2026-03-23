/*
  # Add client and farm columns to fields table

  1. Modified Tables
    - `fields`
      - `client_name` (text, nullable) - Name of the first client associated with the field
      - `client_id` (text, nullable) - John Deere ID of the first client
      - `farm_name` (text, nullable) - Name of the first farm associated with the field
      - `farm_id` (text, nullable) - John Deere ID of the first farm

  2. Notes
    - Only the first client and first farm are stored per field
    - These columns are populated during field import from John Deere API
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'client_name'
  ) THEN
    ALTER TABLE fields ADD COLUMN client_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE fields ADD COLUMN client_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'farm_name'
  ) THEN
    ALTER TABLE fields ADD COLUMN farm_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'farm_id'
  ) THEN
    ALTER TABLE fields ADD COLUMN farm_id text;
  END IF;
END $$;
