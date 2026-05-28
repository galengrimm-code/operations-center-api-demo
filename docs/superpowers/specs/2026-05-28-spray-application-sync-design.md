# Spray-application sync — design spec

**Date:** 2026-05-28
**Status:** DRAFT — pending Galen review
**Author:** Claude (with Codex consult + Farm-Budget pattern audit + real JD response captured Phase 0c)
**Related:** `SESSION-HANDOFF.md`, `PROJECT-LOG.md` 2026-05-28 entry

---

## 1. Goal

Import John Deere Operations Center **APPLICATION** (spray) field operations into the OPS Center app with full per-product (tank-mix-ingredient) data, so the user can answer:
- "How many gallons of atrazine did I apply across all fields this season?"
- "What was applied to field X this year?" and across years
- (future) "What did chemical inputs cost per acre on field X?"

The build sets up the data layer for two declared strategic ambitions:
- **Displace Harvest Profit** (existing $1,600/yr SaaS Galen pays) by eventually adding a product-cost layer
- **Feed OPS Center data into Farm-Budget** (sibling app in same Supabase project) for cross-app analytics

Both ambitions are out of scope for THIS build but inform the schema shape.

---

## 2. Scope

### In scope
- Pull APPLICATION fieldOperations for crop seasons 2024, 2025, 2026 (three-season history)
- Capture per-product tank-mix breakdown with rates, totals, areas, carrier flag
- New `products` catalog auto-populated by JD's stable product UUIDs (no manual matching required)
- **Product classification** (`product_category`: `fertilizer` | `chemical` | `seed` | `adjuvant` | `other` — 5-bucket vocabulary aligned with Harvest Profit's UX) — seeded from a lookup table on first import for ~20 common ag products, manually editable per product, persists across all applications. Per-line override available for the rare case where the same SKU is categorized differently in different operations.
- **Editable JD-imported values** — user can override `rate_value`, `total_value`, `area_value` on any product row, with revert-to-JD-original path; re-imports skip edited rows
- Seed migration with ~20 common ag products pre-classified (atrazine, glyphosate, UAN, urea, etc.) so Galen's first import doesn't require manual classification of obvious items
- Two new UI surfaces: `/applications` (operation list with filters) and `/products` (rollup view)
- New tab on field detail showing applications for that field
- Frontend `checkMutationResult` pattern (per Farm-Budget audit) on all new mutations
- Address pre-existing tech debt on new endpoints: Zod input validation, generic error responses, restricted CORS, JWT auth pattern
- Split `supabase/functions/john-deere-import/index.ts` (currently 689 lines) into per-action modules — overdue per existing project guardrail

### Out of scope (explicit)
- **Map UI changes** — existing `/map` continues to work, no spray overlay
- **Cost / pricing data layer** — no cost columns, no price-entry UI, no $/acre rollups (Harvest Profit covers this for now)
- **Tillage operations** — same plumbing pattern, deferred to backburner
- **Manufacturer / EPA registration / active ingredients** — JD does not expose these fields; not required for the use case
- **Multi-org users sharing a tenancy** — current data model is user-owned (multi-tenant via `user_id`); shared-org tenancy is a future schema decision
- **Cross-link to Farm-Budget's `yield_records.treatments`** — backburner item
- **Re-import scheduling / automation** — manual trigger from UI only (matches existing pattern)

---

## 3. Hard constraints (carried forward)

- **Shared Supabase project** (`nuxofsjzrgdauzriraze`) — Farm-Budget owns `public`, this app owns `operations_center`. NEVER place new tables in `public`.
- **Multi-tenancy via `user_id`** on every row — existing pattern.
- **RLS day-one** on every new table per portfolio guardrail.
- **Edge functions deploy with `verify_jwt: false`** — they validate JWTs internally via `getAuthenticatedUser` (see `.claude/rules/edge-functions.md`).
- **Existing security gaps** to NOT widen on new endpoints: CORS wildcard, error response leakage, no input validation, no rate limiting. New endpoints fix the gaps for themselves.

---

## 4. Architecture

### 4.1 Data model — new tables

Two new tables in `operations_center` schema. Reuse the existing `field_operations` table (with `operation_type = 'application'`).

#### `operations_center.products`

One row per unique JD product per (user, org). Auto-populated on import.

```sql
CREATE TABLE operations_center.products (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id                   text NOT NULL,
  jd_product_id            text NOT NULL,  -- JD's stable UUID/hash — the match key
  name                     text NOT NULL,
  name_normalized          text NOT NULL,  -- lower(trim(name)) — for future alias detection
  brand                    text,           -- JD often returns "---" for missing
  is_carrier_default       boolean NOT NULL DEFAULT false,
  product_kind             text,           -- STRUCTURAL: 'constituent' | 'tank_mix_recipe' | null
  product_category         text,           -- FUNCTIONAL: 'fertilizer' | 'chemical' | 'seed' | 'adjuvant' | 'other' | null  -- aligns with Harvest Profit's mental model (per Galen's reference screenshot 2026-05-28)
  product_category_source  text,           -- 'seed' | 'user' | null  — how the category got set, for transparency
  default_unit             text,           -- e.g. 'gal' — populated from first sighting (for future cost layer)
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  raw_response             jsonb,          -- full JD product object for forward protection
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_jd_uniq UNIQUE (user_id, org_id, jd_product_id)
);

CREATE INDEX products_user_org_idx ON operations_center.products (user_id, org_id);
CREATE INDEX products_name_normalized_idx ON operations_center.products (user_id, org_id, name_normalized);
CREATE INDEX products_category_idx ON operations_center.products (user_id, org_id, product_category);
```

Notes:
- `user_id` is on `products` (not just org-scoped) — matches the existing auth model. If multi-user org tenancy ever lands, migrate then, not now.
- `name_normalized` is maintained by the import path (computed at insert/update). Generated column is an option but kept as plain text for simplicity + index control.
- `product_kind` (structural) is nullable — populated heuristically (outer ApplicationProductTotal → `tank_mix_recipe`, inner ProductTotal → `constituent`). Not user-facing.
- **`product_category`** (functional) is the user-facing classification. NOT in JD's API. Populated two ways (single source of truth per Codex v2 review):
  1. **Seed list** — migration `20260528120300_seed_common_products_classifications.sql` matches new products against patterns in `operations_center.product_category_seeds` table (see section 4.6). `product_category_source = 'seed'`.
  2. **User override** — user edits via UI; `product_category_source = 'user'`. User edits NEVER get overwritten by seed lookup on re-import.
  3. If no seed match AND user hasn't set it: `product_category` is null. UI surfaces uncategorized products in a "needs classification" bucket.
- Stored as `text` (not enum) so future categories don't require migration. Recommended values for v1 UI: `fertilizer | chemical | seed | adjuvant | other` (5 buckets matching Harvest Profit's mental model).

#### `operations_center.field_operation_products`

One row per ingredient (inner `ProductTotal`) applied per operation. The analytics workhorse.

```sql
CREATE TABLE operations_center.field_operation_products (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- DENORMALIZED per Codex (analytics query speed)
  org_id                   text NOT NULL,                                              -- DENORMALIZED per Codex
  field_operation_id       uuid NOT NULL REFERENCES operations_center.field_operations(id) ON DELETE CASCADE,
  product_id               uuid NOT NULL REFERENCES operations_center.products(id) ON DELETE RESTRICT,
  line_index               integer NOT NULL,   -- stable line key for re-import merge; equals position in JD's flattened applicationProductTotals[i].productTotals[j] array
  product_category_override text,              -- per-line override of products.product_category (Codex v2 A). Effective category = COALESCE(override, products.product_category)
  is_carrier               boolean NOT NULL DEFAULT false,
  -- Live values (editable by user; displayed in UI)
  rate_value               double precision,
  rate_unit                text,
  rate_variable            text,
  total_value              double precision,
  total_unit               text,
  total_variable           text,
  area_value               double precision,
  area_unit                text,
  -- JD original values (set on import, NEVER overwritten by user edits — revert source)
  rate_value_jd_original    double precision,
  total_value_jd_original   double precision,
  area_value_jd_original    double precision,
  -- Edit tracking
  is_user_edited           boolean NOT NULL DEFAULT false,
  edited_at                timestamptz,
  -- Re-import merge support (Codex v2 G)
  deleted_at               timestamptz,     -- soft-delete: set when JD no longer reports this line and it isn't user-edited
  raw_response             jsonb,           -- the JD ProductTotal object verbatim
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fop_line_uniq UNIQUE (field_operation_id, line_index)
);

CREATE INDEX fop_user_org_idx ON operations_center.field_operation_products (user_id, org_id);
CREATE INDEX fop_field_operation_idx ON operations_center.field_operation_products (field_operation_id);
CREATE INDEX fop_product_idx ON operations_center.field_operation_products (product_id);
CREATE INDEX fop_user_org_product_idx ON operations_center.field_operation_products (user_id, org_id, product_id);  -- /products rollup hot path
```

Notes:
- `user_id` + `org_id` denormalized for RLS query speed (per Codex section 5) — avoids forced JOIN to `field_operations` on every read of the `/products` rollup.
- Consistency enforced via insert trigger (below) that copies `user_id` + `org_id` from `field_operations` on insert. Cheaper than a check constraint with subquery.
- `line_index` = position in the JD `applicationProductTotals[...].productTotals[]` array. Avoids the duplicate-product-in-same-operation collision Codex flagged.
- `raw_response` is the inner ProductTotal verbatim. The OUTER ApplicationProductTotal (tank-mix-recipe aggregate) is preserved in `field_operations.raw_response`.
- **Editable values + revert path:** On JD import, `rate_value` AND `rate_value_jd_original` both get JD's value (likewise for `total_value` and `area_value`). When the user edits the live `rate_value`, the `_jd_original` column is untouched, `is_user_edited` flips to `true`, `edited_at` gets `now()`. Revert action copies `_jd_original` back to the live column, clears the flag/timestamp. Which specific columns were edited can be derived at query time via `rate_value IS DISTINCT FROM rate_value_jd_original` etc. — no separate tracking column needed (Codex v2 E).
- **No auto-derivation between rate / total / area on edit.** If user edits rate, total stays as the user previously set it (or JD's original if untouched). Trust the user. Avoids "I changed X and Y changed without asking" surprises. UI shows a soft inconsistency badge when `abs(rate × area − total) > epsilon` to flag broken identity, but save proceeds (Codex v2 F).
- **Re-import: merge by `line_index`, not delete+reinsert** (Codex v2 G — resolves the contradiction in v2). For each operation with `is_user_edited = false` on a given line, upsert by `(field_operation_id, line_index)`. For lines where `is_user_edited = true`, do not touch the live values OR `is_user_edited`/`edited_at`. Lines that appear in JD's response but not in DB → INSERT. Lines that exist in DB but not in JD's current response → SET `deleted_at = now()` (soft-delete) only if `is_user_edited = false`; preserve user-edited lines even if JD dropped them.

#### Extension to existing `operations_center.field_operations`

Three new columns:

```sql
ALTER TABLE operations_center.field_operations
  ADD COLUMN measurement_status text DEFAULT 'unknown' NOT NULL;
  -- 'available' = ApplicationRateResult fetched successfully
  -- 'not_found' = JD returned 404 (real, see Phase 0c findings — 2/3 sampled ops)
  -- 'error'     = transient error (rate limit, 5xx, parse failure)
  -- 'unknown'   = default; pre-existing rows (HARVEST/SEEDING) will keep this until they get a measurement

ALTER TABLE operations_center.field_operations
  ADD COLUMN application_name text,                       -- e.g. "Corn Blend", "NH3", "Fall burndown", "Infurrow" — auto-populated from JD outer ApplicationProductTotal.name, user-editable
  ADD COLUMN application_name_jd_original text,           -- preserved JD source for revert
  ADD COLUMN application_name_user_edited boolean NOT NULL DEFAULT false;
```

Notes:
- Pre-existing HARVEST/SEEDING rows default to 'unknown' for `measurement_status` — no backfill needed.
- `application_name` is the operation-level descriptive label seen in Harvest Profit's UI (Galen's reference screenshot 2026-05-28) — separate from `crop_name` (which is the crop being grown) and `variety_name` (which is the seeded variety). For APPLICATION operations only; HARVEST and SEEDING rows leave it null.
- The auto-populate logic: if a JD response has one outer `ApplicationProductTotal`, use its `name` (e.g., "Infurrow"). If multiple outer entries with different names, concatenate (e.g., "Atrazine + 2,4-D") OR use the first — TBD during implementation based on observed data variety. If JD provides no name (or only `"---"`), leave null and let user fill in.
- Re-import preserves `application_name` when `application_name_user_edited = true`.

### 4.2 Trigger — backup consistency guard

```sql
CREATE OR REPLACE FUNCTION operations_center.fop_set_user_org_from_field_op()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.org_id IS NULL THEN
    SELECT user_id, org_id INTO NEW.user_id, NEW.org_id
    FROM operations_center.field_operations
    WHERE id = NEW.field_operation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fop_set_user_org_before_insert
  BEFORE INSERT ON operations_center.field_operation_products
  FOR EACH ROW EXECUTE FUNCTION operations_center.fop_set_user_org_from_field_op();
```

**The trigger is a backup guard, not the primary user_id/org_id mechanism** (Codex v2 H2 — RLS `WITH CHECK` can fire before BEFORE-INSERT triggers depending on Postgres execution context). The edge function **always writes user_id and org_id explicitly** when inserting; the trigger only fills if they're null (defending against future code paths that forget).

### 4.3 RLS policies

For every new table:

```sql
ALTER TABLE operations_center.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_center.field_operation_products ENABLE ROW LEVEL SECURITY;

-- products
CREATE POLICY "owner_select_products" ON operations_center.products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_products" ON operations_center.products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_products" ON operations_center.products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_products" ON operations_center.products
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- field_operation_products (uses denormalized user_id directly, no join)
CREATE POLICY "owner_select_fop" ON operations_center.field_operation_products
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner_insert_fop" ON operations_center.field_operation_products
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_update_fop" ON operations_center.field_operation_products
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner_delete_fop" ON operations_center.field_operation_products
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

No `USING (true)`. No permissive shortcuts. Captured entirely in migrations (Farm-Budget audit lesson: out-of-band policies cause un-reproducible deploys).

### 4.4 Explicit GRANTs

Per Farm-Budget's hard-learned gotcha (PostgREST silent 42501):

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.products TO authenticated;
GRANT ALL ON operations_center.products TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON operations_center.field_operation_products TO authenticated;
GRANT ALL ON operations_center.field_operation_products TO service_role;
```

### 4.5 Migrations

Four migrations, timestamp-named per existing convention:

```
supabase/migrations/20260528120000_create_products_table.sql
supabase/migrations/20260528120100_create_field_operation_products_table.sql
supabase/migrations/20260528120200_add_measurement_status_to_field_operations.sql
supabase/migrations/20260528120300_seed_common_products_classifications.sql
```

Each schema migration contains: `CREATE TABLE` + indexes + RLS enable + policies + GRANTs in one `BEGIN; COMMIT;` block (Farm-Budget pattern). The seed migration is INSERT-only.

### 4.6 Seed list of common product classifications

The seed migration populates a name-keyed classification lookup the import pipeline consults. NOT a user-data insert — these are classifications keyed on `name_normalized` patterns, applied when a NEW product is first seen in import. Stored in a tiny lookup table:

```sql
CREATE TABLE operations_center.product_category_seeds (
  name_pattern         text PRIMARY KEY,         -- lowercase substring/exact match — e.g., 'atrazine'
  match_type           text NOT NULL DEFAULT 'contains', -- 'contains' | 'exact'
  product_category     text NOT NULL,            -- e.g., 'herbicide'
  notes                text
);

INSERT INTO operations_center.product_category_seeds (name_pattern, match_type, product_category, notes) VALUES
  -- Chemicals (herbicides + fungicides + insecticides — all map to 'chemical' in HP's mental model)
  ('atrazine',    'contains', 'chemical', 'herbicide'),
  ('glyphosate',  'contains', 'chemical', 'herbicide — roundup powermax etc.'),
  ('roundup',     'contains', 'chemical', 'herbicide'),
  ('2,4-d',       'contains', 'chemical', 'herbicide'),
  ('dicamba',     'contains', 'chemical', 'herbicide'),
  ('outlook',     'exact',    'chemical', 'herbicide — BASF brand — exact to avoid false match'),
  ('zidua',       'contains', 'chemical', 'herbicide'),
  ('liberty',     'contains', 'chemical', 'herbicide — glufosinate'),
  ('enlist',      'contains', 'chemical', 'herbicide'),
  -- Fertilizers
  ('uan',         'exact',    'fertilizer', '28%, 32% — exact to avoid junk match'),
  ('urea',        'contains', 'fertilizer', NULL),
  ('map ',        'contains', 'fertilizer', '11-52-0 — trailing space to avoid mapleseed etc.'),
  ('dap',         'exact',    'fertilizer', '18-46-0'),
  ('potash',      'contains', 'fertilizer', NULL),
  ('anhydrous',   'contains', 'fertilizer', 'anhydrous ammonia (NH3)'),
  ('zinc sulf',   'contains', 'fertilizer', 'micronutrient'),
  ('gypsum',      'contains', 'fertilizer', 'soil amendment / sulfur source'),
  -- Adjuvants / additives
  ('ams',         'exact',    'adjuvant', 'ammonium sulfate'),
  ('nis',         'exact',    'adjuvant', 'non-ionic surfactant'),
  ('mso',         'exact',    'adjuvant', 'methylated seed oil'),
  -- Carriers (will also be auto-flagged via JD carrier: true)
  ('water',       'exact',    'other', 'carrier; usually flagged via JD carrier=true anyway');
```

Notes:
- Pattern matching is `name_normalized LIKE '%' || name_pattern || '%'` for `match_type = 'contains'`, exact equality for `match_type = 'exact'`.
- Categories use the 5-bucket HP-aligned vocabulary; the finer-grained type (herbicide vs fungicide vs micronutrient) is preserved in the `notes` column for transparency and future sub-categorization filtering.
- The list is intentionally short — covers Galen's most likely products in northeast Kansas corn/soy. Easy to extend later.
- Import logic: if a NEW product's `name_normalized` matches a seed pattern AND `product_category` is null, set category from seed with `product_category_source = 'seed'`. User edits ALWAYS win over re-seeding.

---

## 5. Import strategy

### 5.1 File split (mandatory per existing guardrail)

Current `supabase/functions/john-deere-import/index.ts` (689 lines) splits into:

```
supabase/functions/john-deere-import/
├── index.ts                         (~80 lines — dispatch only)
├── actions/
│   ├── import-fields.ts             (existing logic, lifted)
│   ├── import-operations.ts         (HARVEST + SEEDING — existing logic, lifted)
│   ├── import-applications.ts       (NEW — the spray work + product layer)
│   ├── import-field-operations.ts   (existing per-field action, lifted)
│   ├── debug-field-boundaries.ts    (existing debug, lifted)
│   └── debug-field-operations.ts    (existing debug, lifted)
├── helpers/
│   ├── fetch-measurement-data.ts    (extracted from current ~lines 260-298)
│   ├── fetch-map-image.ts           (extracted from current ~lines 305-367)
│   ├── pagination.ts                (next-page link follower)
│   └── normalize.ts                 (name_normalized helper for products catalog)
└── shared/
    ├── errors.ts                    (per Codex: shared generic-error responder, no leakage)
    ├── validation.ts                (per Codex: Zod schemas for query params + bodies)
    └── types.ts                     (JD response types)
```

`supabase/functions/_shared/` stays as-is (used by all four functions). The split is INSIDE `john-deere-import/` only.

The temporary `debug-spray-shape` function is DELETED at the end of execution.

### 5.2 New action: `import-applications`

Triggered by `?action=import-applications` (and bundled into `import-fields` like operations already are).

Algorithm:
1. Read stored fields from `operations_center.fields` for (user, org)
2. For each field, call `GET /organizations/{org}/fields/{field}/fieldOperations?fieldOperationType=APPLICATION` (paginated via `links[].rel === "nextPage"`)
3. Filter to `cropSeason ∈ {2024, 2025, 2026}` client-side (JD doesn't expose a server-side filter)
4. For each application:
   - Upsert into `field_operations` (operation_type = 'application', `measurement_status = 'unknown'`). If the row is being CREATED (not just updated), set `application_name` from JD's outer aggregate (see below). If `application_name_user_edited = true` on an existing row, leave `application_name` untouched.
   - Call `GET /platform/fieldOperations/{id}/measurementTypes/ApplicationRateResult` with `Accept-UOM-System: ENGLISH` header
     - On 404: set `measurement_status = 'not_found'`, skip product extraction, continue
     - On 5xx / network error: set `measurement_status = 'error'`, skip, continue
     - On 200: set `measurement_status = 'available'`, proceed to product extraction
   - **Derive `application_name`** from the measurement response (deterministic rule per Codex v2 D):
     - Collect non-empty, non-`"---"` names from all outer `ApplicationProductTotal` entries
     - Sort the distinct set alphabetically
     - Join with `"; "` separator
     - If no usable names: leave null (user fills in manually)
     - NO storage-level truncation — UI truncates for display
     - Also set `application_name_jd_original` to the same derived value at first import (for revert path)
   - For each `applicationProductTotals[i]`:
     - For each inner `productTotals[j]`:
       - Upsert into `products` catalog by `(user_id, org_id, jd_product_id)`
       - Insert into `field_operation_products` with `line_index = global_counter++` (flat numbering across ALL outer aggregates for this operation — see section 9.1 for rationale)
   - Preserve the full ApplicationRateResult response in `field_operations.raw_response`

### 5.3 Imperial units — JD does conversion for us

All ApplicationRateResult fetches send `Accept-UOM-System: ENGLISH`. Phase 0c confirmed JD returns `gal`, `ac`, `gal1ac-1`, `mi1hr-1` etc. when this header is set. No conversion layer needed. Store as-received.

### 5.4 Idempotency + re-import merge (Codex v2 G)

- `products` upsert by `(user_id, org_id, jd_product_id)` — re-imports update `last_seen_at` only, don't duplicate. NEVER overwrites `product_category` if `product_category_source = 'user'`.
- `field_operations` upsert by `(user_id, org_id, jd_operation_id)` (existing). NEVER overwrites `application_name` if `application_name_user_edited = true`.
- `field_operation_products` MERGE by `(field_operation_id, line_index)`:
  1. For each line in JD's current response, look up matching DB row
  2. **If no matching row:** INSERT new row (with `user_id`, `org_id` written explicitly by edge function)
  3. **If row exists and `is_user_edited = false`:** UPDATE live columns from JD; also refresh `*_jd_original` columns (in case JD's source values changed)
  4. **If row exists and `is_user_edited = true`:** SKIP — leave live values, `*_jd_original`, `is_user_edited`, `edited_at`, `product_category_override` untouched
  5. **For DB rows whose `line_index` is NOT in JD's current response:**
     - If `is_user_edited = false`: SET `deleted_at = now()` (soft-delete)
     - If `is_user_edited = true`: leave untouched (preserve user-edited orphans)
- All UI/analytics queries default to `WHERE deleted_at IS NULL`. Soft-deleted lines remain queryable for audit only.

### 5.5 Input validation (Zod) on the new action

```typescript
// shared/validation.ts
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

export const ImportApplicationsQuery = z.object({
  action: z.literal("import-applications"),
  fieldId: z.string().uuid().optional(),  // if present, scope to one field
  seasons: z.string().optional(),          // CSV "2024,2025,2026"; default = "2024,2025,2026"
});
```

Parse with `safeParse` and return generic error on failure. Never echo Zod issue text to client.

### 5.6 Error response discipline

`shared/errors.ts` exports `genericError(status, code)` that returns `{ error: 'request_failed', code: 'IMPORT_APP_001' }` — no `error.message`, no `error.stack`, no upstream payload. Server-side `console.error` logs the full context.

---

## 6. UI surface

### 6.1 New routes

- **`/applications`** — list view of all application operations, filterable by: field, product, season, date range. Each row expands to show the tank mix (Harvest Profit-style — see Galen's 2026-05-28 reference screenshot).
- **`/products`** — rollup view: one row per product, columns for total quantity applied (per season), # of fields, # of operations, `product_category`. Click-through to filter `/applications` by that product.
- **`/fields/[fieldId]` extension** — new "Applications" tab on the field detail page, showing all applications for that field (chronological).

### 6.2 UI layout — applications list (HP-aligned)

Reference: Harvest Profit screenshot 2026-05-28. Mirroring their proven UX for the operation list + expanded-tank-mix view, adapted to our 5-category vocabulary and our schema.

**Collapsed operation row (1 line per application):**
```
[date]  [application_name]  [Application icon]  [cost/ac placeholder]  [N items]  [Edit]
```

**Expanded operation row** (when user clicks Edit):
- Editable date picker
- Editable `application_name` (free text)
- "Application" type label
- Total cost/ac (placeholder for future cost layer — empty for v1)
- Item count

**Products section within expanded row** (grouped by `product_category`):
```
💧 Fertilizer
  ──────────────────────────────────────────────────────────────────
  Product Name           Amount               Rate × Unit       Actions
  Anhydrous Ammonia      151.13 lbs           — / ac            [Set Acres] [Revert]
  ──────────────────────────────────────────────────────────────────

🧪 Chemical
  ──────────────────────────────────────────────────────────────────
  Atrazine               79.00 ac at 4 qt/ac  4 qt / ac         [Set Acres] [Revert]
  ──────────────────────────────────────────────────────────────────

💦 Adjuvant
  ...
```

- Each row shows `total_value + total_unit`, `area_value + area_unit`, and `rate_value + rate_unit` as separate editable inputs
- Per-row `[Revert]` button shows when `is_user_edited = true`; copies `*_jd_original` back to live columns
- `[Set Acres]` opens a small input for the per-line area override (matches HP's affordance)
- Category badges (💧/🧪/🌱) — category name + icon, grouped visually
- Water/carrier rows hidden by default; "Show carriers" toggle reveals (per spec 9.2)

**"Imported Machine Rate" toggle (matches HP's "Custom / Machine" toggle):**
- When `is_user_edited = false`: shows "Imported Machine Rate" — read-only
- When `is_user_edited = true`: shows "Custom" — editable, with revert affordance

**NOT in v1 UI (deferred):**
- Cost / Rate columns (cost layer is out of scope)
- "Add Fertilizer / Chemical / Seed" buttons to manually add a line item (HP affordance for products JD didn't report)
- "Tank Mix?" toggle with carrier + carrier-rate metadata (derivable from line items today)

### 6.3 Component structure

```
components/applications/
├── applications-list.tsx               (main list view, /applications route)
├── application-row.tsx                 (collapsed row)
├── application-expanded.tsx            (expanded edit view)
├── product-line-row.tsx                (one line in the products table — editable)
├── product-line-revert.tsx             (revert-to-JD-original button + confirmation)
├── application-filters.tsx             (field/product/season/date/category)
└── products-rollup-table.tsx           (the /products view)

components/fields/
└── field-applications-tab.tsx          (new tab on /fields/[id])

lib/
└── applications-client.ts              (fetch wrappers calling new edge function actions)
```

Match existing patterns: Tailwind, shadcn/ui, `emerald-600` primary, `cyan-*` for water/carrier, `slate-*` for text.

### 6.4 Frontend conventions

- `'use client'` at top of every component using hooks
- Each async mutation wrapped in `try/catch` with `error` + `isLoading` state (existing pattern)
- Every Supabase mutation wraps the result in `checkMutationResult(data, operation, expected=1)` (Farm-Budget pattern) to catch silent RLS failures
- Optimistic UI on inline edits (rate / total / area / category / application_name) with rollback on save failure
- Zod-validate user edits before sending: number ≥ 0 for value fields, `product_category` against the 5-bucket list (with free-text override path documented)

### 6.5 Visualizations

No charts in v1. Tables only. Charts (e.g., "atrazine usage trend year-over-year") deferred to follow-on after the data layer proves out.

### 6.6 Edit mutation contract (frontend ↔ Supabase, Codex v2 H5)

Edits do NOT go through new edge functions — they use the Supabase browser client directly. RLS enforces authorization. `checkMutationResult` catches silent failures.

**Editing a product line (rate / total / area / category override):**
```typescript
// lib/applications-client.ts
async function editProductLine(lineId: string, edits: {
  rate_value?: number | null;
  total_value?: number | null;
  area_value?: number | null;
  product_category_override?: string | null;
}) {
  const validated = ProductLineEditSchema.parse(edits);  // Zod
  const { data, error } = await supabase
    .from('field_operation_products')
    .update({
      ...validated,
      is_user_edited: true,
      edited_at: new Date().toISOString(),
    })
    .eq('id', lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, 'edit product line', 1);
}

async function revertProductLine(lineId: string) {
  // Reset to JD originals via a single update
  const { data: row, error: readErr } = await supabase
    .from('field_operation_products').select('*').eq('id', lineId).single();
  if (readErr) throw readErr;
  const { data, error } = await supabase
    .from('field_operation_products')
    .update({
      rate_value: row.rate_value_jd_original,
      total_value: row.total_value_jd_original,
      area_value: row.area_value_jd_original,
      product_category_override: null,
      is_user_edited: false,
      edited_at: null,
    })
    .eq('id', lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, 'revert product line', 1);
}
```

**Editing a product's catalog category (affects all lines of that product):**
```typescript
async function editProductCategory(productId: string, category: ProductCategory) {
  const { data, error } = await supabase
    .from('products')
    .update({
      product_category: category,
      product_category_source: 'user',
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, 'edit product category', 1);
}
```

**Editing the operation-level `application_name`:**
```typescript
async function editApplicationName(operationId: string, name: string) {
  const { data, error } = await supabase
    .from('field_operations')
    .update({
      application_name: name,
      application_name_user_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', operationId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, 'edit application name', 1);
}
```

**Conflict behavior:** last-write-wins via `updated_at`. No optimistic concurrency for v1 (single-user app). Add if/when multi-user editing ships.

**RLS coverage:** the existing owner-scoped policies (section 4.3) cover all of the above. No new policies needed for the edit path.

---

## 7. Testing approach

No automated tests in this project (per CLAUDE.md). Validation:

- `npm run typecheck` and `npm run build` must pass on every commit
- `npm run lint` must pass
- Manual verification by Galen:
  1. Run `import-applications` from UI → expect products + tank mix rows appear in DB
  2. Open `/applications` → expect rows with tank-mix expand
  3. Open `/products` → expect "X gallons of EnzUpP across N fields" rollup
  4. Open `/fields/A Test Clean out/applications` → expect that field's apps
- Re-run import → expect no duplicates (idempotency check)
- Inspect a known 404 operation in DB → expect `measurement_status = 'not_found'` and no product rows

---

## 8. Tech-debt addressed by this build

From `TECH-DEBT.md`:
- `john-deere-import/index.ts > 500 lines` — RESOLVED via split
- New endpoints ship with Zod, generic errors, restricted CORS — does not widen the existing gaps on the new surface (the existing gaps on the 4 existing functions remain debt to be cleaned up separately)

Tech debt NOT addressed (continues as-is):
- Existing 4 edge functions' CORS wildcard, error leakage, missing input validation, missing rate limiting — separate cleanup
- `irrigation-analysis.tsx`, `progress/page.tsx`, etc. >500 lines — separate cleanup
- Next 13.5.x residual CVEs — deferred to deliberate Next 16 migration

---

## 9. Decisions locked (with rationale) — per Galen's "you're the senior developer" delegation

These were judgment calls made during design rather than questions bounced back. Documented so future me / future Galen can push back if the rationale doesn't hold up.

### 9.1 `line_index` is FLAT across all outer aggregates for one operation
**Decision:** Single counter 0..N across the entire flattened `applicationProductTotals[i].productTotals[j]` array for an operation. NOT per-outer-aggregate.
**Rationale:** The unique constraint `(field_operation_id, line_index)` is simpler with flat numbering. The outer-aggregate grouping signal is preserved in `field_operations.raw_response` for anyone who needs it. Analytics queries don't care about outer grouping; they care about products.

### 9.2 `/products` rollup hides carrier rows by default
**Decision:** UI default-filters `is_carrier = true` rows out of the `/products` view. A "show carriers" toggle reveals water/UAN.
**Rationale:** Galen's primary use case is "how much atrazine did I apply" — water and surfactants are noise in that view. The data is preserved (so compliance use cases can show them), just hidden by default.

### 9.3 `import-fields` auto-chains to `import-applications`
**Decision:** The existing import-fields → import-operations chain extends to import-applications. One-click "give me everything" from the UI.
**Rationale:** The existing UX is a single import button. Forcing two clicks for spray data is friction without benefit. JD API cost is bounded (one-time per user-triggered action).

### 9.4 Re-fetch 404'd operations on every import-applications run
**Decision:** Operations in `field_operations` with `measurement_status = 'not_found'` are re-fetched on every import-applications call, in case JD has since processed them.
**Rationale:** Phase 0c showed 2/3 sampled ops returned 404, plausibly because JD's pipeline hadn't processed recent ops yet. Re-fetching opportunistically captures the data when JD catches up. Cost is bounded because import is user-triggered, not scheduled.

---

## 10. Forward-looking notes (NOT in this build)

These shape today's decisions but are not implemented now:

- **Cost layer**: future table `operations_center.product_price_events (id, user_id, org_id, product_id, effective_date, unit, price_per_unit, currency, source, notes)`. Joins to `products.id`. Cost rollups compute via `field_operation_products.total_value * price_per_unit` with effective-date matching.
- **Farm-Budget integration**: cross-schema query `SELECT yr.*, fop.* FROM public.yield_records yr JOIN operations_center.field_operation_products fop ON ...` becomes feasible once products + applications are normalized. May eventually replace Farm-Budget's `yield_records.treatments` JSONB with a query view.
- **Tillage operations**: same plumbing pattern as applications, no product layer. Defer until applications ship.
- **Re-import scheduling**: today is manual; a cron-triggered nightly sync is a natural follow-on.

---

## 11. Phased execution order

After this spec is approved, the implementation plan (`writing-plans` skill output) will atomize the work in this order:

1. **Migrations** — three SQL files, applied via `mcp__supabase__apply_migration` to staging-equivalent (this app has no staging — applied directly to shared project; confirm with Galen before applying)
2. **File split of `john-deere-import`** — extract per-action files with no behavior change; verify with build + typecheck + manual run of existing actions
3. **Add `import-applications` action** + helpers + Zod validation + error discipline
4. **Frontend `lib/applications-client.ts`** + types
5. **`/applications` route + table component**
6. **`/products` route + rollup component**
7. **`/fields/[fieldId]` applications tab**
8. **Delete temp `debug-spray-shape` function**
9. **Run real import against Galen's account**, verify schema decisions hold against the full data set
10. **Code review (`/code-review`)** before any push

Each phase commits independently. No push to remote until Galen says push.

---

## 12. Sign-off

Galen reviews this spec. On approval, transition to `writing-plans` skill for the implementation plan. Subsequent code lands per the order in section 11.
