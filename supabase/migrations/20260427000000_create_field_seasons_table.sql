-- Field seasons: per-field, per-year planning + manual plant-date overrides.
-- Lets us define "intended crop" + target acres for the season, and backfill
-- planting data for years where John Deere coverage is thin.

CREATE TABLE IF NOT EXISTS operations_center.field_seasons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_id          uuid NOT NULL REFERENCES operations_center.fields(id) ON DELETE CASCADE,
  season_year       integer NOT NULL,

  -- Planning: what's intended for this field this year
  intended_crop     text,
  intended_acres    double precision,

  -- Manual overrides: used when JD has no planting record for this field/year
  -- (or when the JD record is wrong). If set, these win over derived values.
  planted_date      date,
  planted_acres     double precision,

  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, field_id, season_year)
);

CREATE INDEX IF NOT EXISTS idx_field_seasons_user_year
  ON operations_center.field_seasons(user_id, season_year);
CREATE INDEX IF NOT EXISTS idx_field_seasons_field
  ON operations_center.field_seasons(field_id);
CREATE INDEX IF NOT EXISTS idx_field_seasons_crop_year
  ON operations_center.field_seasons(user_id, season_year, intended_crop);

ALTER TABLE operations_center.field_seasons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center'
      AND tablename = 'field_seasons'
      AND policyname = 'Users can view own field seasons'
  ) THEN
    CREATE POLICY "Users can view own field seasons"
      ON operations_center.field_seasons FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center'
      AND tablename = 'field_seasons'
      AND policyname = 'Users can insert own field seasons'
  ) THEN
    CREATE POLICY "Users can insert own field seasons"
      ON operations_center.field_seasons FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center'
      AND tablename = 'field_seasons'
      AND policyname = 'Users can update own field seasons'
  ) THEN
    CREATE POLICY "Users can update own field seasons"
      ON operations_center.field_seasons FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center'
      AND tablename = 'field_seasons'
      AND policyname = 'Users can delete own field seasons'
  ) THEN
    CREATE POLICY "Users can delete own field seasons"
      ON operations_center.field_seasons FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON operations_center.field_seasons
  TO anon, authenticated, service_role;
