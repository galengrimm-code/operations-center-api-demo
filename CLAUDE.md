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

**Farm Data Hub** — a Next.js 13 (App Router) demo that integrates with the John Deere Operations Center API. Users authenticate with Supabase, connect their John Deere account via OAuth 2.0, choose an organization, then browse their fields and harvest operations.

The app can be deployed to **Bolt** or **Netlify** (`netlify.toml` is already present).

---

## Key files

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout; wraps everything in `<AuthProvider>` |
| `app/login/page.tsx` | Sign-in / sign-up form |
| `app/dashboard/page.tsx` | Main dashboard; auth-gated |
| `app/auth/callback/page.tsx` | John Deere OAuth redirect handler |
| `contexts/auth-context.tsx` | Provides `user`, `session`, `johnDeereConnection` to the whole app |
| `lib/supabase.ts` | Supabase browser client |
| `lib/john-deere-client.ts` | `fetch()` wrappers calling Supabase Edge Functions |
| `supabase/functions/john-deere-auth/index.ts` | Edge Function: token exchange, refresh, disconnect |
| `supabase/functions/john-deere-api/index.ts` | Edge Function: organizations, fields, harvest ops |
| `components/dashboard/field-map.tsx` | Mapbox GL map showing imported field boundaries |
| `types/database.ts` | TypeScript types for the `john_deere_connections` table |
| `types/john-deere.ts` | TypeScript types for John Deere API responses |

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
- **Auto token refresh** happens inside `getValidToken()` in the `john-deere-api` edge function — if the token expires within 5 minutes, it refreshes before making the API call. Callers never need to trigger this manually.
- **Sandbox API**: `JOHN_DEERE_API_BASE = "https://sandboxapi.deere.com/platform"`. Change this constant for production use.
- **Edge Functions JWT validation**: Both `john-deere-auth` and `john-deere-api` functions are deployed with `verifyJWT: false` because they handle JWT validation internally using `supabase.auth.getUser()`. This prevents "Invalid JWT" errors that occur when Supabase's automatic JWT verification runs before the function code.
- **Field boundary conversion**: John Deere's proprietary boundary format (multipolygons with rings of lat/lon points) is converted to standard GeoJSON MultiPolygon at import time and persisted in the `fields` table. This gives instant map rendering on every dashboard visit without calling the John Deere API.
- **Paginated field fetching**: The `import-fields` action follows `nextPage` links from the John Deere API to collect all fields, even for large organizations.

---

## Coding conventions

- Every file that uses React hooks or browser APIs must have `'use client'` as its first line.
- Use `@/` path alias for all imports (maps to project root).
- UI primitives come from `components/ui/` (shadcn/ui). Do not edit these files by hand — add new ones with `npx shadcn-ui add <component>`.
- Tailwind CSS for all styling. Primary action color: `emerald-600`. Neutral/text: `slate-*`.
- Async operations in components follow the pattern:
  ```ts
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  try { ... } catch (err) { setError(err instanceof Error ? err.message : '...') }
  ```
- New John Deere data types go in `types/john-deere.ts`.
- New API calls go in `lib/john-deere-client.ts` (client-side fetch wrapper) and the corresponding `if (action === "...")` block in `supabase/functions/john-deere-api/index.ts`.

---

## Database schema

**`john_deere_connections`**

```sql
id               uuid PK
user_id          uuid FK → auth.users (UNIQUE, CASCADE DELETE)
access_token     text
refresh_token    text
token_expires_at timestamptz
selected_org_id  text (nullable)
selected_org_name text (nullable)
created_at       timestamptz
updated_at       timestamptz
```

Migration file: `supabase/migrations/20260205140923_create_john_deere_tokens_table.sql`

**`fields`**

```sql
id                  uuid PK
user_id             uuid FK → auth.users (CASCADE DELETE)
org_id              text (John Deere organization ID)
jd_field_id         text (John Deere field ID)
name                text (field name)
boundary_geojson    jsonb (nullable, GeoJSON MultiPolygon)
boundary_area_value double precision (nullable)
boundary_area_unit  text (nullable, e.g. "ha" or "ac")
active_boundary     boolean (default false)
imported_at         timestamptz
created_at          timestamptz
updated_at          timestamptz
UNIQUE(user_id, org_id, jd_field_id)
```

Migration file: `supabase/migrations/*_create_fields_table.sql`

---

## John Deere OAuth scopes

```
ag1 ag2 ag3 org1 org2 work1 work2 offline_access
```

The redirect URI must be registered in the John Deere Developer Portal and must match `<origin>/auth/callback` exactly.

---

## Common tasks

### Add a new dashboard data view
1. Add an `if (action === "your-action")` block in `supabase/functions/john-deere-api/index.ts`.
2. Add a `fetchYourData()` function in `lib/john-deere-client.ts`.
3. Add response types to `types/john-deere.ts`.
4. Create a component in `components/dashboard/` and add it to `app/dashboard/page.tsx`.

### Deploy Edge Functions

**IMPORTANT:** Both functions MUST be deployed with `verifyJWT: false` because they handle JWT validation internally.

```bash
# When using Supabase CLI:
supabase functions deploy john-deere-auth --no-verify-jwt
supabase functions deploy john-deere-api --no-verify-jwt
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
Connect the repo on Netlify. The `netlify.toml` already sets the build command and plugin. Add the three `NEXT_PUBLIC_*` environment variables in Netlify site settings.
