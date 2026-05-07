# Architecture (hand-curated context)

> Stack, folder structure, key files, and data flow are auto-managed in
> `CLAUDE.md` SCAN:AUTO block. This file holds the irreducible context
> the scan tool can't derive — warnings, design decisions, and rationale.

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

## Doc map

| File | When to read |
|---|---|
| `CLAUDE.md` SCAN:AUTO block | Stack, folder structure, key files, data flow, security flags — auto-loaded every session |
| `.claude/rules/architecture.md` | This file — design rationale + shared-Supabase warning — auto-loaded every session |
| `.claude/rules/database.md` | `operations_center` schema (3 tables) — auto-loaded every session |
| `.claude/rules/conventions.md` | Coding conventions + common task recipes — auto-loaded every session |
| `.claude/rules/edge-functions.md` | Edge Functions deployment + verifyJWT rule — auto-loaded when editing `supabase/functions/**` |
