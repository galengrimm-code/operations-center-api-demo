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

## Migration discipline

All migrations live in `supabase/migrations/` and must target `operations_center.<table>` explicitly. Before pushing: confirm the linked Supabase project ref is `nuxofsjzrgdauzriraze`, not the wrong project.
