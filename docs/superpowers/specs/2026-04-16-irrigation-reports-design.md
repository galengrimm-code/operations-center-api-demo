# Irrigation Reports Design Spec

## Overview

A reports page that shows irrigated vs dryland acreage and yield breakdowns across all fields with irrigated boundaries, filterable by year, crop, and field. Results are cached in a dedicated database table so analysis only runs once per operation. Includes year-over-year trends with weighted averaging, and CSV/PDF export.

## Database

### New table: `operations_center.irrigation_analysis_results`

```sql
CREATE TABLE operations_center.irrigation_analysis_results (
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

CREATE POLICY "Users can manage their own analysis results"
  ON operations_center.irrigation_analysis_results
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON operations_center.irrigation_analysis_results
  TO anon, authenticated, service_role;
```

Lives in the `operations_center` schema alongside existing tables. RLS ensures per-user isolation. The `UNIQUE(user_id, jd_operation_id)` constraint prevents duplicate analysis for the same operation.

## Architecture: Hybrid (Approach B)

Edge Functions handle JD API calls and shapefile storage. The browser performs polygon classification using the existing `lib/shapefile-analysis.ts` library. Results are written to the database by the client.

This avoids Edge Function timeouts for the heavy analysis work and reuses existing client-side classification code.

## Report Page (`/reports`)

### Route

`app/(app)/reports/page.tsx` — new page in the existing `(app)` route group (auth-gated).

### Filters

Three dropdowns at the top of the page:

- **Year**: Defaults to most recent season with data. Options derived from distinct `crop_season` values in `field_operations`.
- **Crop**: "All" (default), or filter to a specific crop (CORN_WET, SOYBEANS, CORN_EURO, etc.).
- **Field**: "All" (default), or filter to a specific field. Only fields with `has_irrigated_boundary = true` appear.

### Main Table

Only fields with irrigated boundaries appear. One row per field per crop per operation in the selected year.

Columns:

| Column | Source | Always available? |
|--------|--------|-------------------|
| Field | `fields.name` | Yes |
| Crop | `field_operations.crop_name` | Yes |
| Irrigated Ac | `fields.irrigated_boundary_area_value` | Yes |
| Dryland Ac | `fields.boundary_area_value - irrigated_boundary_area_value` | Yes |
| Total Ac | `field_operations.area_value` or boundary total | Yes |
| Irrigated Yield (bu/ac) | `irrigation_analysis_results.irrigated_yield` | After analysis |
| Dryland Yield (bu/ac) | `irrigation_analysis_results.dryland_yield` | After analysis |
| Total Yield (bu/ac) | `field_operations.avg_yield_value` | Yes |
| Irrigated Moisture % | `irrigation_analysis_results.irrigated_moisture` | After analysis |
| Dryland Moisture % | `irrigation_analysis_results.dryland_moisture` | After analysis |
| Total Moisture % | `field_operations.avg_moisture` | After analysis |
| Action | Run / Re-run button | Always |

Un-analyzed rows show `--` for irrigated/dryland yield and moisture columns, with a "Run" button in the action column. After analysis, the button changes to a "Re-run" option.

### Summary Row

Bottom of the table. Shows:

- **Acreage**: Sum of irrigated, dryland, and total acres across all visible rows.
- **Yield**: Weighted average by acreage. Formula: `SUM(yield * acres) / SUM(acres)` for each of irrigated yield, dryland yield, and total yield.
- **Moisture**: Weighted average by acreage, same formula.

Only includes rows that have analysis results for the yield/moisture averages.

### Action Buttons

- **Run All Analysis**: Loops through all un-analyzed operations in the current filtered view, running them sequentially. Shows progress: "Analyzing Bills - Corn 2025... 3 of 12". Each completed operation updates the table immediately. Failures are logged and skipped — the batch continues.
- **Export CSV**: Downloads the current table data (respecting filters) as a CSV file.
- **Export PDF**: Generates a styled PDF of the current table with summary row. Includes the trends section if a field/crop is selected.

### Trends Section

Below the main table. Separate filter dropdowns for field and crop. Shows year-over-year data for the selected field + crop combination:

| Year | Irr Ac | Dry Ac | Total Ac | Irr Yield | Dry Yield | Total Yield |
|------|--------|--------|----------|-----------|-----------|-------------|
| 2025 | 125.3 | 14.1 | 139.4 | 247.1 | 198.3 | 241.5 |
| 2024 | 125.3 | 14.1 | 139.4 | 247.1 | 216.6 | 243.8 |
| 2023 | 125.3 | 14.1 | 139.4 | 221.4 | 189.2 | 217.6 |
| **AVG** | **125.3** | **14.1** | **139.4** | **238.5** | **201.4** | **234.3** |

Average row uses weighted averages (by acreage). Only includes years where analysis has been run.

## Data Flow

### Loading the report page

1. Query `operations_center.fields` where `has_irrigated_boundary = true` — get all irrigated fields with their boundary data.
2. Query `operations_center.field_operations` filtered by selected year (and crop/field if filtered) — join with the fields from step 1 to get operations for irrigated fields only.
3. Query `operations_center.irrigation_analysis_results` — get any cached analysis for the operations from step 2.
4. Render table. Acreage columns come from boundary data (always available). Yield/moisture columns come from cached results or show `--`.

### Running analysis for a single operation

1. Call `john-deere-irrigation` Edge Function with `action=shapefile-status&operationId=X`. This checks Supabase Storage for a cached shapefile, or fetches from JD and uploads it.
2. Client downloads the zip from Supabase Storage via `supabase.storage.from('shapefiles').download(path)`.
3. Client runs `processShapefile()` to parse the zip into GeoJSON.
4. Client runs `classifyHarvestPolygons()` (or `classifySeedingPolygons()`) from `lib/shapefile-analysis.ts`, using the field's `irrigated_boundary_geojson` as the classification boundary.
5. Client upserts the result into `operations_center.irrigation_analysis_results`.
6. Table row updates immediately.

### Batch "Run All Analysis"

1. Identify all operations in the current filtered view without cached results.
2. Loop through them one at a time, running the same flow as single analysis.
3. Show progress indicator: "Analyzing [Field] - [Crop] [Year]... N of M".
4. Each completed operation updates the table in real time.
5. If one fails, log the error and show "Failed" on that row. Continue to the next.

### Re-run

1. Delete the existing row from `irrigation_analysis_results` for that operation.
2. Delete the cached shapefile from Supabase Storage (forces fresh download from JD).
3. Run the analysis again (same flow as single analysis).

## Component Structure

```
app/(app)/reports/page.tsx              Server component shell

components/reports/
  reports-view.tsx                      Main client component — state, filters, data loading
  reports-table.tsx                     Data table with per-row Run/Re-run buttons
  reports-summary-row.tsx               Weighted average totals row
  reports-trends.tsx                    Year-over-year trends section with field/crop picker
  reports-filters.tsx                   Year/Crop/Field filter dropdowns
  reports-export.tsx                    CSV and PDF export buttons
  analysis-runner.tsx                   Single + batch analysis execution with progress UI

lib/
  reports-data.ts                       Queries for loading report data, saving/deleting results
  reports-export-utils.ts               CSV generation and PDF HTML template
```

Reuses existing:
- `lib/shapefile-analysis.ts` — polygon classification (no changes needed)
- `lib/supabase.ts` — database client (already configured for `operations_center` schema)
- `lib/john-deere-client.ts` — Edge Function calls for shapefile fetching
- `lib/area-utils.ts` — unit conversion

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Shapefile fetch fails (JD 403/timeout) | Show "Failed — Retry" on that row. Don't block batch. |
| JD returns 406 (no shapefile available) | Show "N/A" instead of Run button. Total yield still shown from JD data. |
| Classification fails | Catch error, show on row. Results not saved. User can retry. |
| Export with missing data | CSV/PDF exports whatever is available. Un-analyzed rows show blanks for yield columns. |

## Not In Scope

- No chart/graph visualizations (tables only for v1)
- No automatic re-analysis when fields are re-imported (manual re-run)
- No seeding yield metrics in trends (seeding has acreage only, not yield)
- No cross-field aggregation in trends (one field + one crop at a time)
- No scheduled/automatic batch runs
