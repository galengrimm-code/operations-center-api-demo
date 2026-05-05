---
paths:
  - "supabase/functions/**"
---

# Edge Functions (Supabase / Deno)

Four functions, all under `supabase/functions/`:

- `john-deere-auth/` — token exchange, refresh, disconnect
- `john-deere-api/` — organizations, stored fields/operations
- `john-deere-import/` — import fields (with boundaries) + operations from JD API (658 lines — split before adding more)
- `john-deere-irrigation/` — irrigation analysis, shapefile proxying

## Critical: deploy with `verifyJWT: false`

**All edge functions MUST be deployed with `verifyJWT: false`** because they handle JWT validation internally using `supabase.auth.getUser()`. Deploying with the default verifyJWT-on causes "Invalid JWT" errors before the function code runs.

```bash
# Via Supabase CLI:
supabase functions deploy john-deere-auth --no-verify-jwt
supabase functions deploy john-deere-api --no-verify-jwt
supabase functions deploy john-deere-import --no-verify-jwt
supabase functions deploy john-deere-irrigation --no-verify-jwt
supabase secrets set JOHN_DEERE_CLIENT_ID=<value>
supabase secrets set JOHN_DEERE_CLIENT_SECRET=<value>
```

Via the MCP tool in this codebase:
```typescript
mcp__supabase__deploy_edge_function({
  slug: "john-deere-auth",
  verify_jwt: false
})
```

## Auth pattern (every function)

Every edge function follows this auth pattern (`_shared/auth.ts:8` initializes the Supabase client with `db: { schema: 'operations_center' }`):

```ts
const user = await getAuthenticatedUser(req)
if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
```

## Token refresh

All JD API calls use `getValidToken()` from `_shared/john-deere.ts` — auto-refreshes if the token expires within 5 minutes. **Don't refresh manually.**

## John Deere OAuth scopes

Currently requests:
```
ag1 ag2 ag3 org1 org2 work1 work2 offline_access
```

These are broader than current functionality requires (read-only would be `ag1 org1 work1 offline_access`). Scope reduction is flagged P3 in the SCAN:AUTO block — trim before adding write functionality.

The redirect URI must be registered in the John Deere Developer Portal and must match `<origin>/auth/callback` exactly.

## Security gaps to avoid widening

These are flagged P1/P2/P3 in the SCAN:AUTO block — when editing edge functions, don't make them worse:

- **CORS wildcard** in `_shared/cors.ts` — restrict to `https://operations-center-api-demo.vercel.app` + `http://localhost:3000` instead of `*`.
- **Error response leakage** — never forward `error.message`, `error.stack`, or full upstream response bodies to HTTP responses. Log server-side, return generic messages.
- **No input validation** — add Zod schemas before parsing `req.json()` and using fields directly.
- **No rate limiting** — add rate limiting to any new endpoint, especially anything that triggers paid JD API calls (e.g., shapefile polling).
