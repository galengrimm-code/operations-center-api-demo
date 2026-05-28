# JD API fixtures

Captured responses from the John Deere Operations Center API, used by Vitest + Deno tests.

## Files

- `application-rate-result-single-tankmix.json` — clean APPLICATION measurement with one tank mix line (active herbicide + water carrier). Source: Phase 0c capture 2026-05-28 from Galen's "A Test/ Clean out" field.
- `application-rate-result-404.json` — real JD 404 error payload for a missing measurement.
- `application-operations-list.json` — `GET /fieldOperations?fieldOperationType=APPLICATION` response shape.

## Refreshing fixtures

When JD's API shape changes, run `npx tsx scripts/capture-jd-fixtures.ts` against a live signed-in account (requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` + a JWT from a real session). The script writes new files here. Manually anonymize org/field/operation IDs before committing.

## Tests using these

- `supabase/functions/john-deere-import/__tests__/extract-tankmix.test.ts`
- `supabase/functions/john-deere-import/__tests__/derive-application-name.test.ts`
- `supabase/functions/john-deere-import/__tests__/import-applications.test.ts`
