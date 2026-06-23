# Database Schema

All tables live in the `operations_center` schema (NOT `public` — that's Farm Budget's). Project ref: `nuxofsjzrgdauzriraze`.

## `operations_center.john_deere_connections`

```sql
id                   uuid PK
user_id              uuid FK → auth.users (UNIQUE, CASCADE DELETE)
access_token         text
refresh_token        text
token_expires_at     timestamptz
selected_org_id      text (nullable)
selected_org_name    text (nullable)
preferred_area_unit  text (default 'ac')
hidden_crop_names    text[] (default '{}', crops hidden from all UIs e.g. RYE, GRASSLAND)
created_at           timestamptz
updated_at           timestamptz
```

One row per user. RLS ensures users only see their own row. Edge Functions use service-role key to bypass RLS for token operations.

## `operations_center.fields`

```sql
id                              uuid PK
user_id                         uuid FK → auth.users (CASCADE DELETE)
org_id                          text (John Deere organization ID)
jd_field_id                     text (John Deere field ID)
name                            text (field name)
boundary_geojson                jsonb (nullable, GeoJSON MultiPolygon — active boundary)
boundary_area_value             double precision (nullable)
boundary_area_unit              text (nullable, e.g. "ha" or "ac")
active_boundary                 boolean (default false)
irrigated_boundary_geojson      jsonb (nullable, GeoJSON MultiPolygon — irrigated boundary)
irrigated_boundary_area_value   double precision (nullable)
irrigated_boundary_area_unit    text (nullable)
has_irrigated_boundary          boolean (default false)
client_name                     text (nullable)
client_id                       text (nullable)
farm_name                       text (nullable)
farm_id                         text (nullable)
raw_response                    jsonb (nullable, full JD API response)
imported_at                     timestamptz
created_at                      timestamptz
updated_at                      timestamptz
UNIQUE(user_id, org_id, jd_field_id)
```

Boundaries are pre-converted from JD's proprietary multi-polygon format to standard GeoJSON at import time so the map renders without round-tripping through JD.

## `operations_center.field_operations`

```sql
id                  uuid PK
user_id             uuid FK → auth.users (CASCADE DELETE)
org_id              text
jd_field_id         text
jd_operation_id     text
operation_type      text (e.g. "harvest", "seeding")
crop_season         text (nullable)
crop_name           text (nullable)
start_date          text (nullable)
end_date            text (nullable)
variety_name        text (nullable)
machine_name        text (nullable)
machine_vin         text (nullable)
area_value          double precision (nullable)
area_unit           text (nullable)
avg_yield_value     double precision (nullable)
avg_yield_unit      text (nullable)
avg_moisture        double precision (nullable)
total_wet_mass_value double precision (nullable)
total_wet_mass_unit text (nullable)
measurement_type    text (nullable)
map_image_path      text (nullable, Supabase Storage path)
map_image_extent    jsonb (nullable, lat/lon extent for map overlay)
map_image_legends   jsonb (nullable, color legend ranges)
raw_response        jsonb (nullable)
imported_at         timestamptz
created_at          timestamptz
updated_at          timestamptz
UNIQUE(user_id, org_id, jd_operation_id)
```

**Application extensions (2026-05-28):** `measurement_status` text ('available' | 'not_found' | 'error' | 'unknown' — JD measurement fetch state), `application_name` text (editable tank-mix label), `application_name_jd_original` text, `application_name_user_edited` boolean.

## `operations_center.irrigation_analysis_results`

```sql
id                  uuid PK
user_id             uuid FK → auth.users (CASCADE DELETE)
field_id            uuid
jd_field_id         text
jd_operation_id     text
operation_type      text
crop_name           text
crop_season         text
irrigated_acres     double precision
dryland_acres       double precision
total_acres         double precision
irrigated_yield     double precision (nullable)
dryland_yield       double precision (nullable)
total_yield         double precision (nullable)
irrigated_moisture  double precision (nullable)
dryland_moisture    double precision (nullable)
total_moisture      double precision (nullable)
irrigated_bushels   double precision (nullable)
dryland_bushels     double precision (nullable)
polygon_count       integer (default 0)
analyzed_at         timestamptz
created_at          timestamptz
UNIQUE(user_id, jd_operation_id)
```

Cached shapefile-analysis output (irrigated/dryland yield splits) so charts render without re-running analysis.

## `operations_center.field_seasons`

```sql
id              uuid PK
user_id         uuid FK → auth.users (CASCADE DELETE)
field_id        uuid FK → operations_center.fields (CASCADE DELETE)
season_year     integer
intended_crop   text (nullable, planning)
intended_acres  double precision (nullable)
planted_date    date (nullable, manual override when JD record missing/wrong)
planted_acres   double precision (nullable)
notes           text (nullable)
created_at      timestamptz
updated_at      timestamptz
UNIQUE(user_id, field_id, season_year)
```

## `operations_center.products`

```sql
id                       uuid PK
user_id                  uuid FK → auth.users (CASCADE DELETE)
org_id                   text
jd_product_id            text
name                     text
name_normalized          text (trim/lowercase/collapse-whitespace key)
brand                    text (nullable)
is_carrier_default       boolean (default false)
product_kind             text (nullable)
product_category         text (nullable: chemical/fertilizer/seed/carrier/other)
product_category_source  text (nullable: seed-pattern vs user)
default_unit             text (nullable)
density_lbs_per_gal      numeric (nullable, cross-family unit conversion bridge)
nutrient_content_pct     numeric (nullable, e.g. NH3 = 82 — JD logs lb of N, priced per ton of product)
price_unit_default       text (nullable, default for the per-product price-unit picker)
first_seen_at            timestamptz
last_seen_at             timestamptz
raw_response             jsonb (nullable)
created_at               timestamptz
updated_at               timestamptz
UNIQUE(user_id, org_id, jd_product_id)
```

## `operations_center.field_operation_products`

```sql
id                         uuid PK
user_id                    uuid (auto-filled from field_operation via trigger)
org_id                     text (auto-filled via trigger)
field_operation_id         uuid FK → field_operations (CASCADE DELETE)
product_id                 uuid FK → products (RESTRICT DELETE)
line_index                 integer
product_category_override  text (nullable)
is_carrier                 boolean (default false)
rate_value / rate_unit / rate_variable       (live editable)
total_value / total_unit / total_variable    (live editable — COST MATH USES total, NOT rate)
area_value / area_unit                       (live editable)
rate_value_jd_original / total_value_jd_original / area_value_jd_original  (set on import, never user-modified)
is_user_edited             boolean (default false)
edited_at                  timestamptz (nullable)
deleted_at                 timestamptz (nullable, soft-delete for re-import merge)
raw_response               jsonb (nullable)
created_at / updated_at    timestamptz
UNIQUE(field_operation_id, line_index)
```

## `operations_center.product_prices`

```sql
id              uuid PK
user_id         uuid FK → auth.users (CASCADE DELETE)
org_id          text
product_id      uuid FK → products (CASCADE DELETE)
year            integer
price_per_unit  numeric (>= 0)
price_unit      text (CHECK: ozm|lb|ton|floz|pt|qt|gal)
created_at      timestamptz
updated_at      timestamptz
UNIQUE(user_id, org_id, product_id, year)
```

Year-keyed pricing; the Products page Season selector picks the year (or averages across all years in "All Seasons" mode).

## `operations_center.product_category_seeds`

```sql
name_pattern      text PK
match_type        text (CHECK: contains|exact)
product_category  text
notes             text (nullable)
created_at        timestamptz
```

Global (not per-user) name-pattern → category seed list used to auto-categorize imported products (21 rows, e.g. 'glyphosate' → chemical).

## Reads now served from the `fdh` schema (Track 2, 2026-06-22 — see architecture.md)

The tables above are still the **write** targets, but the app now **reads** through reverse adapter
views `operations_center.fdh_fields / fdh_field_operations / fdh_field_operation_products /
fdh_products / fdh_product_prices`, backed by the normalized **`fdh`** schema (agronomic truth) +
**`farm_overlay`** (FDH-only cost/edit layer: `operation_edit`, `operation_product_edit`,
`product_meta`, `product_price`, `field_season`). The views present the OLD shapes here AND expose the
**legacy id** so write-by-id still round-trips; AFTER triggers on the `operations_center` tables sync
each write into `fdh` + `farm_overlay`. Full fdh schema (35 tables): `supabase/migrations/20260620203501_fdh_v7_schema`
+ `docs/migration/01_fdh_schema.sql`. Reverse views / overlay / triggers: `supabase/migrations/20260622120*`.
Toggle the read source via the `FDH_READ_*` flags (architecture.md).

## Migration discipline

All migrations live in `supabase/migrations/`. operations_center tables target `operations_center.<table>`;
the fdh migration adds the `fdh` + `farm_overlay` schemas. Before pushing: confirm the linked project ref
is `nuxofsjzrgdauzriraze`. NOTE: this project's `schema_migrations` is SHARED with Landowner-Portal +
Farm Budget — `supabase db push` from this repo shows their migrations as "remote-only"; only add THIS
app's rows when reconciling the history.
