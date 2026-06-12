-- Terrace lines: crest/channel centerlines per field, the spatial substrate
-- for conservation math (pool storage, low spots, dirt volumes) and a building
-- block for terrain-zone analysis.
--
-- Lines start as `draft` (machine-detected from lidar) and become `locked`
-- after the user reviews/edits them. Detection re-runs only ever touch drafts;
-- locked lines are permanent field truth. `terrace_no` groups a crest with the
-- channel segment(s) that belong to the same terrace.

CREATE TABLE IF NOT EXISTS operations_center.terraces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id              text NOT NULL,
  jd_field_id         text NOT NULL,

  terrace_no          integer NOT NULL,                       -- groups crest + its channels
  kind                text NOT NULL CHECK (kind IN ('crest', 'channel', 'waterway')),

  -- GeoJSON LineString geometry, lon/lat (WGS84) coordinates
  geom                jsonb NOT NULL,

  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  source              text NOT NULL DEFAULT 'lidar' CHECK (source IN ('lidar', 'machine', 'manual', 'edited', 'driven')),

  length_ft           double precision,
  channel_coverage    double precision,                       -- crests: paired-channel fraction; null for channels
  mean_elevation_ft   double precision,                       -- filled by profile math later
  notes               text,
  locked_at           timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terraces_user_field
  ON operations_center.terraces(user_id, org_id, jd_field_id);
CREATE INDEX IF NOT EXISTS idx_terraces_field_status
  ON operations_center.terraces(user_id, jd_field_id, status);

ALTER TABLE operations_center.terraces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center' AND tablename = 'terraces'
      AND policyname = 'Users can view own terraces'
  ) THEN
    CREATE POLICY "Users can view own terraces"
      ON operations_center.terraces FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center' AND tablename = 'terraces'
      AND policyname = 'Users can insert own terraces'
  ) THEN
    CREATE POLICY "Users can insert own terraces"
      ON operations_center.terraces FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center' AND tablename = 'terraces'
      AND policyname = 'Users can update own terraces'
  ) THEN
    CREATE POLICY "Users can update own terraces"
      ON operations_center.terraces FOR UPDATE USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center' AND tablename = 'terraces'
      AND policyname = 'Users can delete own terraces'
  ) THEN
    CREATE POLICY "Users can delete own terraces"
      ON operations_center.terraces FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.terraces TO authenticated;
GRANT ALL ON operations_center.terraces TO service_role;
