# Architecture

## Critical: shared Supabase project

**This app does NOT have its own Supabase project.** It shares the `Farm Budget / Fin Health` project (ref: `nuxofsjzrgdauzriraze`) and lives entirely inside the `operations_center` schema.

- The `public` schema belongs to the Farm Budget app — **never put Operations Center tables there**.
- All migrations must target `operations_center.<table>` explicitly.
- Edge function Supabase clients set `db: { schema: 'operations_center' }` (see `supabase/functions/_shared/auth.ts:8`).
- When running `supabase db push`, **confirm the linked project ref is `nuxofsjzrgdauzriraze`** before pushing.

## Architecture decisions

- **No direct browser → John Deere API calls.** All calls go through Supabase Edge Functions so the client secret stays server-side.
- **One DB row per user** in `john_deere_connections`. RLS ensures users only see their own row. Edge Functions use the service role key (bypasses RLS) to read/write tokens on the user's behalf.
- **Auto token refresh** happens inside `getValidToken()` in `_shared/john-deere.ts` — if the token expires within 5 minutes, it refreshes before making the API call. Callers never need to trigger this manually.
- **Production API:** `JOHN_DEERE_API_BASE = "https://api.deere.com/platform"` in `_shared/john-deere.ts`.
- **Edge Functions JWT validation:** All edge functions are deployed with `verifyJWT: false` because they handle JWT validation internally using `supabase.auth.getUser()`. This prevents "Invalid JWT" errors that occur when Supabase's automatic JWT verification runs before the function code.
- **Field boundary conversion:** John Deere's proprietary boundary format (multipolygons with rings of lat/lon points) is converted to standard GeoJSON MultiPolygon at import time and persisted in the `fields` table. Instant map rendering on every visit without calling JD API.
- **Separate irrigated boundaries:** The JD Boundaries API (`?recordFilter=all`) is called during import to fetch irrigated boundaries as separate GeoJSON, stored alongside the active boundary. Displayed as cyan dashed outlines on the map.
- **Paginated field fetching:** The `import-fields` action follows `nextPage` links from the John Deere API to collect all fields, even for large organizations.
- **Map-first design:** The primary UI is a full-screen Mapbox satellite map with field boundaries. Fields, operations, and settings are accessible via dedicated routes under the `(app)` route group.

## Data flow

User authenticates via Supabase Auth → auth-context provides session → components call `lib/john-deere-client.ts` with Bearer JWT → Edge Functions validate JWT via `getAuthenticatedUser()` → Edge Functions call John Deere API using stored OAuth tokens → data persisted to PostgreSQL (operations_center schema) → components read stored data → Mapbox GL renders field GeoJSON boundaries from DB.

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
| `supabase/functions/john-deere-import/index.ts` | Edge Function: import fields (with boundaries) + operations from JD API (658 lines — split before adding more) |
| `supabase/functions/john-deere-irrigation/index.ts` | Edge Function: irrigation analysis, shapefile proxying |
| `components/map/full-map.tsx` | Mapbox GL map showing field + irrigated boundary layers |
| `components/map/field-side-panel.tsx` | Field detail slide-in panel with operations |
| `components/dashboard/irrigation-analysis.tsx` | Irrigation analysis with shapefile-based breakdown |
| `types/john-deere.ts` | TypeScript types for John Deere API responses and stored data |

## Doc map

| File | When to read |
|---|---|
| `CLAUDE.md` | Universal context, security scan output, project guardrails | Auto-loaded every session |
| `.claude/rules/architecture.md` | This file — shared Supabase, decisions, key files | Auto-loaded every session |
| `.claude/rules/database.md` | Database schema (3 tables) | Auto-loaded every session |
| `.claude/rules/conventions.md` | Coding conventions + common task recipes | Auto-loaded every session |
| `.claude/rules/edge-functions.md` | Edge Functions deployment + verifyJWT rule | Auto-loaded when editing `supabase/functions/**` |
