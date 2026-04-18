-- Add hidden_crop_names column to operations_center.john_deere_connections.
-- Users can use this to hide cover crops (rye, grassland, etc.) from all views.
-- Stored as a text[] of JD crop name codes (e.g. 'RYE', 'GRASSLAND').

ALTER TABLE operations_center.john_deere_connections
  ADD COLUMN IF NOT EXISTS hidden_crop_names text[] NOT NULL DEFAULT '{}';
