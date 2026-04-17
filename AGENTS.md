# AGENTS.md — Coding Agent Guide

This document is intended for AI coding agents (GitHub Copilot, Cursor, etc.) working in this repository. Read it in full before making changes.

---

## Project overview

**Farm Data Hub** is a Next.js 13 (App Router) web application that:

1. Authenticates users with Supabase Auth (email/password).
2. Lets users connect their John Deere Operations Center account via OAuth 2.0.
3. Proxies John Deere API calls through Supabase Edge Functions (Deno) to keep secrets server-side.
4. Imports fields (with active + irrigated boundaries) and operations (harvest, seeding) into a local database.
5. Displays fields on a Mapbox GL satellite map with boundary overlays and operation map image layers.
6. Provides irrigation analysis that classifies harvest/seeding data into irrigated vs. dryland zones using shapefile-based polygon classification.

The app is deployed to **Vercel**.

---

## Build, lint, and type-check commands

```bash
npm install          # install dependencies
npm run dev          # start Next.js dev server (http://localhost:3000)
npm run build        # production build
npm run lint         # ESLint (next lint)
npm run typecheck    # tsc --noEmit (no output files)
```

There are no automated tests in this project. Use `npm run build` and `npm run typecheck` to validate changes.

---

## Architecture

```
Browser
  │
  ├── Next.js App (frontend)
  │     ├── /login                    — Supabase email/password auth
  │     ├── /map                      — Main map view (field boundaries + irrigated overlays)
  │     ├── /map/field/[fieldId]      — Field detail with side panel
  │     ├── /fields                   — Fields grid list with client/farm filters
  │     ├── /operations               — Operations list with irrigation analysis
  │     ├── /settings                 — User preferences (area unit)
  │     ├── /dashboard                — Legacy dashboard view
  │     └── /auth/callback            — John Deere OAuth redirect handler
  │
  └── Supabase
        ├── Auth              — User accounts
        ├── Database          — john_deere_connections, fields, field_operations tables
        ├── Storage           — operation-images, shapefiles buckets
        └── Edge Functions    — Server-side secrets & John Deere API proxy
              ├── john-deere-auth       — Token exchange / refresh / disconnect
              ├── john-deere-api        — Organizations, stored fields/operations queries
              ├── john-deere-import     — Import fields (with boundaries) + operations from JD API
              └── john-deere-irrigation — Irrigation analysis + shapefile proxying
```

The frontend **never calls the John Deere API directly**. All John Deere calls go through Edge Functions, which hold the client secret.

---

## Directory structure

```
app/
  layout.tsx                        # Root layout; wraps everything in <AuthProvider>
  page.tsx                          # Redirect to /login or /map
  login/page.tsx                    # Sign-in / sign-up UI
  dashboard/page.tsx                # Legacy dashboard page
  auth/callback/page.tsx            # Handles ?code= from John Deere OAuth redirect
  (app)/
    map/page.tsx                    # Main map view (auth-gated)
    map/field/[fieldId]/page.tsx    # Field detail view on map
    fields/page.tsx                 # Fields grid list with filters
    operations/page.tsx             # Operations list with irrigation analysis
    settings/page.tsx               # User settings

components/
  dashboard/
    harvest-operations.tsx          # Harvest operations display
    planting-operations.tsx         # Planting operations display
    irrigation-analysis.tsx         # Irrigation analysis with shapefile processing
    area-unit-toggle.tsx            # Toggle between acres and hectares
    field-filters.tsx               # Client/farm filter controls
  map/
    full-map.tsx                    # Mapbox GL map with field + irrigated boundary layers
    field-side-panel.tsx            # Field detail slide-in panel
    map-controls.tsx                # Map toolbar controls
  overlays/
    connect-overlay.tsx             # John Deere connect overlay
    org-selector-overlay.tsx        # Organization selector overlay
  layout/
    nav-links.tsx                   # Navigation sidebar links
    top-bar.tsx                     # Top navigation bar
    user-menu.tsx                   # User dropdown menu
  ui/                               # shadcn/ui primitives (do not edit manually)

contexts/
  auth-context.tsx                  # React context: user, session, johnDeereConnection
  map-context.tsx                   # React context: fields, selection, operations, filters

lib/
  supabase.ts                       # Supabase browser client (uses NEXT_PUBLIC_* vars)
  john-deere-client.ts              # fetch() wrappers → Supabase Edge Functions
  area-utils.ts                     # Area unit conversion (ha ↔ ac)
  shapefile-analysis.ts             # Shapefile parsing + irrigated/dryland classification
  utils.ts                          # shadcn cn() utility

types/
  database.ts                       # TypeScript types for Supabase tables
  john-deere.ts                     # TypeScript types for JD API responses + stored data

supabase/
  migrations/                       # Database schema migrations (9 files)
  functions/
    _shared/
      auth.ts                       # JWT validation helpers
      boundaries.ts                 # Boundary conversion (JD → GeoJSON), client/farm extraction
      cors.ts                       # CORS response helpers
      john-deere.ts                 # JD API call helpers, token refresh, JOHN_DEERE_API_BASE
    john-deere-auth/index.ts        # Deno edge function: OAuth token management
    john-deere-api/index.ts         # Deno edge function: stored data queries
    john-deere-import/index.ts      # Deno edge function: import fields + operations from JD
    john-deere-irrigation/index.ts  # Deno edge function: irrigation analysis + shapefiles
```

---

## Environment variables

### Frontend (`.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase public anon key |
| `NEXT_PUBLIC_JOHN_DEERE_CLIENT_ID` | Yes | John Deere OAuth client ID (used to build auth URL) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox GL JS public access token (for the field boundary map) |

### Supabase Edge Functions

| Variable | Required | Description |
|----------|----------|-------------|
| `JOHN_DEERE_CLIENT_ID` | Yes | John Deere OAuth client ID |
| `JOHN_DEERE_CLIENT_SECRET` | Yes | John Deere OAuth client secret (never exposed to browser) |
| `SUPABASE_URL` | auto | Injected by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | Injected by Supabase runtime (bypasses RLS) |

---

## Database schema

### `john_deere_connections` (one row per authenticated user)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid FK → `auth.users` | UNIQUE, CASCADE DELETE |
| `access_token` | text | Short-lived John Deere token |
| `refresh_token` | text | Long-lived token for renewal |
| `token_expires_at` | timestamptz | Used to decide when to refresh |
| `selected_org_id` | text (nullable) | Currently selected JD org |
| `selected_org_name` | text (nullable) | Display name for selected org |
| `preferred_area_unit` | text | Default: 'ac' |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `fields` (imported field data with boundaries)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK → `auth.users` | CASCADE DELETE |
| `org_id` | text | John Deere organization ID |
| `jd_field_id` | text | John Deere field ID |
| `name` | text | Field name |
| `boundary_geojson` | jsonb (nullable) | GeoJSON MultiPolygon — active boundary |
| `boundary_area_value` | double precision (nullable) | |
| `boundary_area_unit` | text (nullable) | e.g. "ha" or "ac" |
| `active_boundary` | boolean | |
| `irrigated_boundary_geojson` | jsonb (nullable) | GeoJSON MultiPolygon — irrigated boundary |
| `irrigated_boundary_area_value` | double precision (nullable) | |
| `irrigated_boundary_area_unit` | text (nullable) | |
| `has_irrigated_boundary` | boolean | Quick filter flag |
| `client_name` | text (nullable) | |
| `client_id` | text (nullable) | |
| `farm_name` | text (nullable) | |
| `farm_id` | text (nullable) | |
| `raw_response` | jsonb (nullable) | Full JD API response |

UNIQUE constraint: `(user_id, org_id, jd_field_id)`

### `field_operations` (imported harvest/seeding operations)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK → `auth.users` | CASCADE DELETE |
| `org_id` | text | |
| `jd_field_id` | text | |
| `jd_operation_id` | text | |
| `operation_type` | text | "harvest", "seeding" |
| `crop_season`, `crop_name` | text (nullable) | |
| `start_date`, `end_date` | text (nullable) | |
| `area_value`, `area_unit` | (nullable) | Measurement data |
| `avg_yield_value`, `avg_yield_unit` | (nullable) | |
| `avg_moisture` | double precision (nullable) | |
| `map_image_path` | text (nullable) | Supabase Storage path |
| `map_image_extent` | jsonb (nullable) | Lat/lon extent for map overlay |
| `map_image_legends` | jsonb (nullable) | Color legend ranges |

UNIQUE constraint: `(user_id, org_id, jd_operation_id)`

Row-Level Security is enabled on all tables. Authenticated users can only read/write their own rows. Edge Functions use the service role key and therefore bypass RLS.

---

## OAuth flow (John Deere)

```
1. User clicks "Connect" in the connect overlay
      → getJohnDeereAuthUrl() builds authorize URL with state + redirect_uri
      → Browser redirects to signin.johndeere.com

2. John Deere redirects back to /auth/callback?code=...
      → CallbackPage extracts code
      → exchangeCodeForTokens() calls POST /functions/v1/john-deere-auth?action=exchange
      → Edge Function trades code for tokens and upserts into john_deere_connections

3. On each API call, the edge functions call getValidToken()
      → If token expires within 5 minutes, it auto-refreshes before calling the JD API
```

---

## Supabase Edge Functions

All functions share the same pattern:
1. Validate the `Authorization: Bearer <user_jwt>` header using `supabase.auth.getUser()`.
2. Dispatch on the `?action=` query param.
3. Return JSON with CORS headers.

### `john-deere-auth`

| Action | Method | Description |
|--------|--------|-------------|
| `exchange` | POST | Trade authorization code for tokens; upsert into DB |
| `refresh` | POST | Refresh access token using stored refresh token |
| `disconnect` | POST | Delete the user's connection row |

### `john-deere-api`

| Action | Method | Description |
|--------|--------|-------------|
| `organizations` | GET | List organizations from JD API |
| `select-organization` | POST | Persist selected org ID/name to DB |
| `fields` | GET | Proxy field list from JD API |
| `get-stored-fields` | GET | Query imported fields from local DB |
| `get-stored-operations` | GET | Query imported operations from local DB (supports fieldId, operationType filters) |

### `john-deere-import`

| Action | Method | Description |
|--------|--------|-------------|
| `import-fields` | POST | Fetch all fields from JD (paginated), fetch irrigated boundaries (`?recordFilter=all`), import operations, store everything in DB |
| `import-operations` | POST | Import operations only for already-imported fields |

### `john-deere-irrigation`

| Action | Method | Description |
|--------|--------|-------------|
| `irrigation-analysis` | GET | Analyze field boundary to compute irrigated/dryland acres |
| `shapefile-status` | GET | Check/download shapefile from JD, upload to Supabase Storage |

> **Note:** The app targets the John Deere **production** API (`api.deere.com`).

---

## Key patterns and conventions

- **`'use client'`** at the top of every component that uses hooks or browser APIs.
- **shadcn/ui** components live in `components/ui/`. Do not edit these manually — regenerate via `npx shadcn-ui add <component>`.
- **Tailwind CSS** for all styling. The design system uses `emerald-600` as the primary action color, `cyan-*` for irrigated/water elements, and `slate-*` for text and backgrounds.
- **Path aliases**: `@/` maps to the project root (configured in `tsconfig.json`).
- **Error handling**: every async call in components is wrapped in try/catch with an `error` state that renders an inline error message.
- **Token refresh**: handled transparently in `_shared/john-deere.ts` via `getValidToken()` — callers never need to trigger a refresh manually.
- **Boundary conversion**: JD's proprietary multipolygon format is converted to GeoJSON at import time via `convertBoundaryToGeoJSON()` in `_shared/boundaries.ts`.
- **Irrigated boundaries**: Fetched separately from the JD Boundaries API (`?recordFilter=all`) and stored as their own GeoJSON column. Displayed as cyan dashed outlines on the map.

---

## How to add a new John Deere API endpoint

1. Add a new `if (action === "your-action")` block in the appropriate edge function, or create a new function in `supabase/functions/`.
2. Add a corresponding `export async function fetchYourData()` in `lib/john-deere-client.ts`.
3. Add TypeScript types to `types/john-deere.ts` if needed.
4. Create or update a component to display the data.

---

## Deployment

### Vercel
Connect your GitHub repo to Vercel — Next.js is auto-detected, no config file required. Set the four `NEXT_PUBLIC_*` environment variables in **Project Settings → Environment Variables** (for Production, Preview, and Development). Vercel builds and deploys automatically on every push to `main`.

### Supabase Edge Functions

**IMPORTANT:** All functions MUST be deployed with `--no-verify-jwt` because they handle JWT validation internally.

```bash
supabase functions deploy john-deere-auth --no-verify-jwt
supabase functions deploy john-deere-api --no-verify-jwt
supabase functions deploy john-deere-import --no-verify-jwt
supabase functions deploy john-deere-irrigation --no-verify-jwt
```
Set secrets:
```bash
supabase secrets set JOHN_DEERE_CLIENT_ID=<value>
supabase secrets set JOHN_DEERE_CLIENT_SECRET=<value>
```
