# Backburner

> "Would be nice to..." ideas. Not committed work, not yet scoped.
> Pull from here when you have bandwidth or when something becomes more urgent.
> Don't promote here lightly — this is for ideas worth remembering, not every passing thought.

## Ideas

- **Tillage operations sync** — `tillage` is already in `MEASUREMENT_TYPE_MAP` at `john-deere-import/index.ts:243-248` but excluded from the import loop. Once spray sync is solid, picking up tillage is essentially the same pattern. Trigger: once spray is in production and we want a full picture of field-level activity for the season.
- **Products dictionary normalization** — if the spray-sync build stores products as denormalized strings per application, a follow-up could extract a `products` catalog table (product name → manufacturer → category → label info) so we can answer "all herbicide passes" or "all glyphosate this year" without string matching. Trigger: once we have ~50+ application records and start asking those questions in the UI.

- **Cross-link spray data with Farm-Budget treatments** — Farm-Budget (sibling app in same Supabase project) has a `public.yield_records.treatments` JSONB column that appears to store manually-entered treatment data per yield record. After the OPS Center spray-sync ships, there's a natural question about whether to make these two data sources cross-reference (so a yield record can show "treatments per JD spray records" without manual entry). Defer until both data layers are stable. Triggered by: Farm-Budget patterns audit on 2026-05-28.

## Parked (decided to NOT do — but keep the reasoning)

_None yet._
