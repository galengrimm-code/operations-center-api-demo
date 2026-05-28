# Tech Debt

> Known debt to revisit. Things that work but aren't ideal.
> Updated when new debt is identified, items are resolved, or priorities shift.
> Resolved items move to a Resolved section at the bottom (don't delete — paper trail matters).

> **Source of truth for many of these is the `SCAN:AUTO` block in `CLAUDE.md`** (managed by Watch Tower's `weekly-security-scan`). This file holds engineering debt + the rationale for *why* items aren't fixed yet. Don't paraphrase the scan output here — link to it.

## Active

### CORS wildcard on all Supabase Edge Functions
- **Where:** `supabase/functions/_shared/cors.ts`
- **What:** `Access-Control-Allow-Origin: *` on all 4 functions. Verified live in the SCAN:AUTO block — `curl -I -X OPTIONS ... -H "Origin: https://evil.com"` returns `*`.
- **Why it's debt:** Any origin can hit authenticated endpoints. Currently mitigated by the per-request `getAuthenticatedUser` JWT check (no anonymous data exfiltration), but it's still a violated portfolio guardrail.
- **Cost to fix:** small — restrict to `https://operations-center-api-demo.vercel.app` + `http://localhost:3000` in `_shared/cors.ts`, redeploy 4 functions.
- **Risk of not fixing:** medium — defense-in-depth gap; gets re-flagged on every weekly scan.
- **Trigger:** next time `_shared/cors.ts` is touched for any reason, or when adding the spray-products endpoints (don't widen a gap that's already flagged).

### Error response leakage in all Edge Functions
- **Where:** `john-deere-api/index.ts:132`, `john-deere-auth/index.ts:83`, `john-deere-import/index.ts:687`, `john-deere-irrigation/index.ts:264`
- **What:** `error.message` (and `error.stack` in `john-deere-import`) forwarded to HTTP responses.
- **Why it's debt:** Leaks internal state — SQL errors, JD upstream payloads — to any client.
- **Cost to fix:** small — catch blocks return a generic message, log full error server-side.
- **Risk of not fixing:** medium.
- **Trigger:** before adding any new error path in an edge function (i.e., this needs to be cleaned up as part of the spray-sync build, not after).

### `john-deere-import/index.ts` over 500 lines (689 and growing)
- **Where:** `supabase/functions/john-deere-import/index.ts`
- **What:** 689 lines, multiple actions (`import-fields`, `import-operations`, `import-field-operations`, `debug-field-boundaries`, `debug-field-operations`) and helper functions in one file. Up from 658 at the last scan.
- **Why it's debt:** Single-file edge functions get hard to reason about — the existing CLAUDE.md guardrail says **"do not add to this file — split into per-action modules before adding features."**
- **Cost to fix:** medium — extract per-action handlers (`actions/import-fields.ts`, `actions/import-operations.ts`, etc.) + shared helpers; rewire the dispatch.
- **Risk of not fixing:** medium (debt accelerates as we add spray products on top).
- **Trigger:** **already triggered** — the spray-sync build will add a new action and several helpers, so the split should happen *as part of* that build rather than before/after.

### `irrigation-analysis.tsx` and `progress/page.tsx` over 500 lines
- **Where:** `components/dashboard/irrigation-analysis.tsx` (660), `app/(app)/progress/page.tsx` (639), `components/reports/reports-yield-charts.tsx` (533), `components/reports/reports-view.tsx` (530)
- **What:** Same pattern — single-file components that have crept past the 500-line guardrail.
- **Cost to fix:** medium each, independent.
- **Risk of not fixing:** low–medium (each one still reads OK in isolation, but compounding).
- **Trigger:** next time we add a feature inside one of them.

### No input validation on Edge Function request bodies
- **Where:** All 4 edge functions — `req.json()` parsed and used directly
- **What:** No Zod / schema validation
- **Cost to fix:** small per endpoint
- **Risk of not fixing:** medium — bad inputs can crash functions or be exploited for unexpected behavior
- **Trigger:** new endpoints in the spray-sync build should ship with Zod from day one (don't widen the gap)

### No rate limiting on Edge Functions
- **Where:** All 4 edge functions
- **What:** No rate limit. Most concerning: `john-deere-irrigation` `shapefile-status` triggers paid JD API calls per request.
- **Cost to fix:** medium — needs Upstash/Redis or DB-backed state (in-memory resets on Vercel cold start, per portfolio guardrails)
- **Risk of not fixing:** medium (cost exposure on paid JD endpoints; abuse vector if origin is opened up)
- **Trigger:** before any new endpoint that hits a paid JD API call (this includes spray-product import if JD bills it)

### No server-side route protection (`middleware.ts`)
- **Where:** All `(app)/*` routes — protected only by client-side `useEffect` redirects in `auth-context.tsx`
- **What:** Page HTML loads before client-side redirect fires. Authenticated content isn't actually authenticated until the JS runs.
- **Cost to fix:** small — add `middleware.ts` at project root using `@supabase/ssr`
- **Risk of not fixing:** medium — content flash, plus the auth model isn't actually server-enforced
- **Trigger:** before any sensitive data lands in a new authed page (the spray-products UI is a candidate)

### Overly broad John Deere OAuth scopes
- **Where:** `lib/john-deere-client.ts:288` — `ag1 ag2 ag3 org1 org2 work1 work2 offline_access`
- **What:** Read+write scopes across all 3 ag tiers, when current features are read-only
- **Cost to fix:** trivial — change the scope string + re-consent
- **Risk of not fixing:** low–medium — gives the app more power than it uses; one stolen token leaks more than it should
- **Trigger:** if/when we add a feature that needs write (push records back to JD), revisit the scope set then; until then, trim to `ag1 org1 work1 offline_access`

### Residual Next 13.5.x CVEs
- **Where:** `next@^13.5.11` + 4 high CVEs inside the bundled deps + 1 moderate
- **What:** `npm audit fix --force` would push to `next@16.2.5` (breaking major)
- **Cost to fix:** large — Next 16 migration including App Router behavior changes, possible RSC compatibility review
- **Risk of not fixing:** low–medium — CVEs are mostly DoS classes, not RCE; deployed surface adds layered protections
- **Trigger:** a deliberate Next 16 migration sprint, not a one-off

## Resolved

_None yet. When something here is fixed, move it here with a date + commit reference._
