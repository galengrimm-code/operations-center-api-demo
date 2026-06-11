-- Persisted multi-pass elevation models: one current model per field.
-- The merged IDW grid is stored as jsonb (values rounded to 0.01 ft,
-- null = no coverage) so the Elevation page renders instantly on field
-- select and Phase 2 terrace tools compute against a stable surface.

CREATE TABLE IF NOT EXISTS operations_center.elevation_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  jd_field_id text NOT NULL,
  pass_op_ids text[] NOT NULL,
  pass_stats jsonb NOT NULL,
  -- { lon0, lat0, x0, y0, cellSize, nx, ny, values: (number|null)[] }
  grid jsonb NOT NULL,
  min_z double precision NOT NULL,
  max_z double precision NOT NULL,
  point_count integer NOT NULL DEFAULT 0,
  built_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, jd_field_id)
);

ALTER TABLE operations_center.elevation_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own elevation models"
  ON operations_center.elevation_models FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own elevation models"
  ON operations_center.elevation_models FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own elevation models"
  ON operations_center.elevation_models FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own elevation models"
  ON operations_center.elevation_models FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.elevation_models TO authenticated;
GRANT ALL ON operations_center.elevation_models TO service_role;
