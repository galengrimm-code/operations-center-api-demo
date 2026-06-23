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

## Track 2 — reads migrated onto the `fdh` schema (2026-06-22, LIVE)

The app's **reads** were cut over from the flat `operations_center` tables onto a normalized **`fdh`** schema (the YieldStack v7 layout) plus a **`farm_overlay`** FDH-only edit layer, read through reverse adapter **views** in `operations_center`. Writes still hit the legacy tables; DB triggers sync them into fdh.

- **Read path:** edge funcs (`get-stored-fields`, `get-stored-operations`) and browser queries read `operations_center.fdh_fields / fdh_field_operations / fdh_field_operation_products / fdh_products / fdh_product_prices` (security_invoker views over `fdh` + `farm_overlay`). PostgREST can't embed across views, so `fetchApplications` / `fetchProductsRollup` query each view and join client-side.
- **Write path UNCHANGED:** the JD import + cost-edit functions still write `operations_center.*`. AFTER triggers (`fdh.fn_sync_field_from_legacy`, `farm_overlay.fn_sync_*_from_legacy`) decompose each legacy write into `fdh` core + `farm_overlay`. **Reverse views expose the LEGACY id** so the app's write-by-id round-trips (flips to fdh ids only when legacy is retired).
- **Flags (revert = flip off):** `FDH_READ_FIELDS` + `FDH_READ_OPS` (Supabase edge secrets), `NEXT_PUBLIC_FDH_READ_OPS` (Vercel env), plus `localStorage.fdh_read_ops` per-browser override. `lib/fdh-flags.ts`.
- **fdh core = JD agronomic truth (YieldStack-bound); farm_overlay = FDH cost/edit layer that NEVER flows to YieldStack.** Legacy `operations_center` is kept as the write backbone + fallback; retire later (R5).
- **Migrations:** schema = `20260620203501_fdh_v7_schema` (already tracked); adapter views/triggers/overlay = `supabase/migrations/20260622120{0..4}00_fdh_*` (idempotent; registered applied). One-time data backfills live in `docs/migration/01-08` (not re-runnable migrations). NOTE: `supabase_migrations.schema_migrations` is SHARED across Farm Data Hub / Landowner-Portal / Farm Budget — only ever ADD this app's rows.

## Doc map

| File                              | When to read                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `CLAUDE.md` SCAN:AUTO block       | Stack, folder structure, key files, data flow, security flags — auto-loaded every session     |
| `.claude/rules/architecture.md`   | This file — design rationale + shared-Supabase warning — auto-loaded every session            |
| `.claude/rules/database.md`       | `operations_center` schema (9 tables) — auto-loaded every session                             |
| `.claude/rules/conventions.md`    | Coding conventions + common task recipes — auto-loaded every session                          |
| `.claude/rules/edge-functions.md` | Edge Functions deployment + verifyJWT rule — auto-loaded when editing `supabase/functions/**` |
