-- Per-operation cache of irrigated vs dryland splits produced by client-side
-- shapefile polygon classification. Keyed by (user_id, jd_operation_id).
-- Avoids reparsing the JD harvest shapefile on every reports view render.

CREATE TABLE IF NOT EXISTS operations_center.irrigation_analysis_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  field_id              uuid NOT NULL,
  jd_field_id           text NOT NULL,
  jd_operation_id       text NOT NULL,
  operation_type        text NOT NULL,
  crop_name             text NOT NULL,
  crop_season           text NOT NULL,
  irrigated_acres       double precision NOT NULL,
  dryland_acres         double precision NOT NULL,
  total_acres           double precision NOT NULL,
  irrigated_yield       double precision,
  dryland_yield         double precision,
  total_yield           double precision,
  irrigated_moisture    double precision,
  dryland_moisture      double precision,
  total_moisture        double precision,
  irrigated_bushels     double precision,
  dryland_bushels       double precision,
  polygon_count         integer NOT NULL DEFAULT 0,
  analyzed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, jd_operation_id)
);

ALTER TABLE operations_center.irrigation_analysis_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'operations_center'
      AND tablename = 'irrigation_analysis_results'
      AND policyname = 'Users can manage their own analysis results'
  ) THEN
    CREATE POLICY "Users can manage their own analysis results"
      ON operations_center.irrigation_analysis_results
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT ALL ON operations_center.irrigation_analysis_results
  TO anon, authenticated, service_role;
