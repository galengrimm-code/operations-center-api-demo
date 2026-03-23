/*
  # Create fields table for storing imported John Deere field data with boundaries

  1. New Tables
    - `fields`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, cascade delete)
      - `org_id` (text, John Deere organization ID)
      - `jd_field_id` (text, John Deere field ID)
      - `name` (text, field name from John Deere)
      - `boundary_geojson` (jsonb, nullable, GeoJSON MultiPolygon geometry)
      - `boundary_area_value` (double precision, nullable, numeric area)
      - `boundary_area_unit` (text, nullable, area unit e.g. "ha" or "ac")
      - `active_boundary` (boolean, whether the boundary was the active one)
      - `imported_at` (timestamptz, when the field was last imported)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Constraints
    - Unique constraint on (user_id, org_id, jd_field_id) to support upserts on re-import
    - Index on (user_id, org_id) for fast per-organization lookups

  3. Security
    - Enable RLS on `fields` table
    - SELECT policy: authenticated users can view their own fields
    - INSERT policy: authenticated users can insert their own fields
    - UPDATE policy: authenticated users can update their own fields
    - DELETE policy: authenticated users can delete their own fields
*/

CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  org_id text NOT NULL,
  jd_field_id text NOT NULL,
  name text NOT NULL,
  boundary_geojson jsonb,
  boundary_area_value double precision,
  boundary_area_unit text,
  active_boundary boolean DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, org_id, jd_field_id)
);

ALTER TABLE fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fields"
  ON fields
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fields"
  ON fields
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fields"
  ON fields
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own fields"
  ON fields
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_fields_user_org ON fields(user_id, org_id);
