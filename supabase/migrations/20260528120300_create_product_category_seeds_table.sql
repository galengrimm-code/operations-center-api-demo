-- 20260528120300_create_product_category_seeds_table.sql
-- Lookup table for auto-classifying new products by name pattern.
-- Single source of truth (per Codex v2 C — no parallel hardcoded heuristic).
-- See spec section 4.6.

BEGIN;

CREATE TABLE operations_center.product_category_seeds (
  name_pattern         text PRIMARY KEY,
  match_type           text NOT NULL DEFAULT 'contains',
  product_category     text NOT NULL,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_type_check CHECK (match_type IN ('contains', 'exact'))
);

INSERT INTO operations_center.product_category_seeds (name_pattern, match_type, product_category, notes) VALUES
  -- Chemicals
  ('atrazine',    'contains', 'chemical',   'herbicide'),
  ('glyphosate',  'contains', 'chemical',   'herbicide'),
  ('roundup',     'contains', 'chemical',   'herbicide'),
  ('2,4-d',       'contains', 'chemical',   'herbicide'),
  ('dicamba',     'contains', 'chemical',   'herbicide'),
  ('outlook',     'exact',    'chemical',   'BASF herbicide — exact to avoid false match'),
  ('zidua',       'contains', 'chemical',   'herbicide'),
  ('liberty',     'contains', 'chemical',   'herbicide — glufosinate'),
  ('enlist',      'contains', 'chemical',   'herbicide'),
  -- Fertilizers
  ('uan',         'exact',    'fertilizer', '28%, 32% — exact to avoid junk match'),
  ('urea',        'contains', 'fertilizer', NULL),
  ('map ',        'contains', 'fertilizer', '11-52-0 — trailing space to avoid mapleseed'),
  ('dap',         'exact',    'fertilizer', '18-46-0'),
  ('potash',      'contains', 'fertilizer', NULL),
  ('anhydrous',   'contains', 'fertilizer', 'NH3'),
  ('zinc sulf',   'contains', 'fertilizer', 'micronutrient'),
  ('gypsum',      'contains', 'fertilizer', 'soil amendment'),
  -- Adjuvants
  ('ams',         'exact',    'adjuvant',   'ammonium sulfate'),
  ('nis',         'exact',    'adjuvant',   'non-ionic surfactant'),
  ('mso',         'exact',    'adjuvant',   'methylated seed oil'),
  -- Carrier
  ('water',       'exact',    'other',      'carrier; also flagged via JD carrier=true');

-- Read-only table for users; service_role manages content.
ALTER TABLE operations_center.product_category_seeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_authenticated_read_seeds" ON operations_center.product_category_seeds
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON operations_center.product_category_seeds TO authenticated;
GRANT ALL ON operations_center.product_category_seeds TO service_role;

COMMIT;
