# CLAUDE.md — Claude AI Guide

This file gives Claude the context needed to work effectively in this codebase. Read it before making any changes.

---

## Commands

```bash
npm run dev          # start dev server at http://localhost:3000
npm run build        # production build (checks for type errors + build errors)
npm run lint         # ESLint via next lint
npm run typecheck    # tsc --noEmit (type check without building)
```

There are no automated tests. Use `npm run build` and `npm run typecheck` to validate changes before committing.

---

## What this project is

**Farm Data Hub** — a Next.js 13 (App Router) demo that integrates with the John Deere Operations Center API. Users authenticate with Supabase, connect their John Deere account via OAuth 2.0, choose an organization, then browse their fields, boundaries, and operations (harvest, seeding) on a map-first interface.

The app can be deployed to **Bolt** or **Netlify** (`netlify.toml` is already present).

---

## Key files

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout; wraps everything in `<AuthProvider>` |
| `app/login/page.tsx` | Sign-in / sign-up form |
| `app/(app)/map/page.tsx` | Main map view; auth-gated |
| `app/(app)/map/field/[fieldId]/page.tsx` | Field detail view on map |
| `app/(app)/fields/page.tsx` | Fields grid list with client/farm filters |
| `app/(app)/operations/page.tsx` | Operations list with irrigation analysis |
| `app/(app)/settings/page.tsx` | User settings (area unit preference) |
| `app/auth/callback/page.tsx` | John Deere OAuth redirect handler |
| `contexts/auth-context.tsx` | Provides `user`, `session`, `johnDeereConnection` to the whole app |
| `contexts/map-context.tsx` | Map state: fields, selection, operations, filters |
| `lib/supabase.ts` | Supabase browser client |
| `lib/john-deere-client.ts` | `fetch()` wrappers calling Supabase Edge Functions |
| `lib/area-utils.ts` | Area unit conversion (ha ↔ ac) |
| `lib/shapefile-analysis.ts` | Shapefile parsing + irrigated/dryland polygon classification |
| `supabase/functions/_shared/john-deere.ts` | Shared: JD API helpers, token refresh, `JOHN_DEERE_API_BASE` |
| `supabase/functions/_shared/boundaries.ts` | Shared: boundary conversion (JD → GeoJSON), client/farm extraction |
| `supabase/functions/john-deere-auth/index.ts` | Edge Function: token exchange, refresh, disconnect |
| `supabase/functions/john-deere-api/index.ts` | Edge Function: organizations, stored fields/operations |
| `supabase/functions/john-deere-import/index.ts` | Edge Function: import fields (with boundaries) + operations from JD API |
| `supabase/functions/john-deere-irrigation/index.ts` | Edge Function: irrigation analysis, shapefile proxying |
| `components/map/full-map.tsx` | Mapbox GL map showing field + irrigated boundary layers |
| `components/map/field-side-panel.tsx` | Field detail slide-in panel with operations |
| `components/dashboard/irrigation-analysis.tsx` | Irrigation analysis with shapefile-based breakdown |
| `types/john-deere.ts` | TypeScript types for John Deere API responses and stored data |

---

## Environment variables

### `.env.local` (Next.js frontend)

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_JOHN_DEERE_CLIENT_ID=<client-id>
NEXT_PUBLIC_MAPBOX_TOKEN=<mapbox-public-token>
```

### Supabase Edge Function secrets (set via Supabase CLI or dashboard)

```
JOHN_DEERE_CLIENT_ID=<client-id>
JOHN_DEERE_CLIENT_SECRET=<client-secret>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the Supabase runtime.

---

## Architecture decisions

- **No direct browser → John Deere API calls.** All calls go through Supabase Edge Functions so the client secret stays server-side.
- **One DB row per user** in `john_deere_connections`. RLS ensures users can only see their own row. Edge Functions use the service role key (bypasses RLS) to read/write tokens on the user's behalf.
- **Auto token refresh** happens inside `getValidToken()` in `_shared/john-deere.ts` — if the token expires within 5 minutes, it refreshes before making the API call. Callers never need to trigger this manually.
- **Production API**: `JOHN_DEERE_API_BASE = "https://api.deere.com/platform"` in `_shared/john-deere.ts`.
- **Edge Functions JWT validation**: All edge functions are deployed with `verifyJWT: false` because they handle JWT validation internally using `supabase.auth.getUser()`. This prevents "Invalid JWT" errors that occur when Supabase's automatic JWT verification runs before the function code.
- **Field boundary conversion**: John Deere's proprietary boundary format (multipolygons with rings of lat/lon points) is converted to standard GeoJSON MultiPolygon at import time and persisted in the `fields` table. This gives instant map rendering on every visit without calling the John Deere API.
- **Separate irrigated boundaries**: The JD Boundaries API (`?recordFilter=all`) is called during import to fetch irrigated boundaries as separate GeoJSON, stored alongside the active boundary. Irrigated boundaries are displayed as cyan dashed outlines on the map.
- **Paginated field fetching**: The `import-fields` action follows `nextPage` links from the John Deere API to collect all fields, even for large organizations.
- **Map-first design**: The primary UI is a full-screen Mapbox satellite map with field boundaries. Fields, operations, and settings are accessible via dedicated routes under the `(app)` route group.

---

## Coding conventions

- Every file that uses React hooks or browser APIs must have `'use client'` as its first line.
- Use `@/` path alias for all imports (maps to project root).
- UI primitives come from `components/ui/` (shadcn/ui). Do not edit these files by hand — add new ones with `npx shadcn-ui add <component>`.
- Tailwind CSS for all styling. Primary action color: `emerald-600`. Irrigated/water: `cyan-*`. Neutral/text: `slate-*`.
- Async operations in components follow the pattern:
  ```ts
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  try { ... } catch (err) { setError(err instanceof Error ? err.message : '...') }
  ```
- New John Deere data types go in `types/john-deere.ts`.
- New API calls go in `lib/john-deere-client.ts` (client-side fetch wrapper) and the corresponding edge function.

---

## Database schema

**`john_deere_connections`**

```sql
id                   uuid PK
user_id              uuid FK → auth.users (UNIQUE, CASCADE DELETE)
access_token         text
refresh_token        text
token_expires_at     timestamptz
selected_org_id      text (nullable)
selected_org_name    text (nullable)
preferred_area_unit  text (default 'ac')
created_at           timestamptz
updated_at           timestamptz
```

**`fields`**

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

**`field_operations`**

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

---

## John Deere OAuth scopes

```
ag1 ag2 ag3 org1 org2 work1 work2 offline_access
```

The redirect URI must be registered in the John Deere Developer Portal and must match `<origin>/auth/callback` exactly.

---

## Common tasks

### Add a new dashboard data view
1. Add an action handler in the appropriate edge function (or create a new one in `supabase/functions/`).
2. Add a `fetchYourData()` function in `lib/john-deere-client.ts`.
3. Add response types to `types/john-deere.ts`.
4. Create a component in `components/dashboard/` or `components/map/` and wire it into the appropriate page.

### Deploy Edge Functions

**IMPORTANT:** All edge functions MUST be deployed with `verifyJWT: false` because they handle JWT validation internally.

```bash
# When using Supabase CLI:
supabase functions deploy john-deere-auth --no-verify-jwt
supabase functions deploy john-deere-api --no-verify-jwt
supabase functions deploy john-deere-import --no-verify-jwt
supabase functions deploy john-deere-irrigation --no-verify-jwt
supabase secrets set JOHN_DEERE_CLIENT_ID=<value>
supabase secrets set JOHN_DEERE_CLIENT_SECRET=<value>
```

If deploying via the MCP tool in this codebase, use:
```typescript
mcp__supabase__deploy_edge_function({
  slug: "john-deere-auth",
  verify_jwt: false
})
```

### Deploy to Netlify
Connect the repo on Netlify. The `netlify.toml` already sets the build command and plugin. Add the four `NEXT_PUBLIC_*` environment variables in Netlify site settings.
