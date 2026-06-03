# Backburner

> "Would be nice to..." ideas. Not committed work, not yet scoped.
> Pull from here when you have bandwidth or when something becomes more urgent.
> Don't promote here lightly — this is for ideas worth remembering, not every passing thought.

## Ideas

- **Profit / revenue layer (retire Harvest Profit outright).** The cost-per-acre layer shipped 2026-06-03 is half of what HP does. The other half: **yields × grain price − input costs = margin per field/acre**. The yield/harvest data is already imported from JD and the input-cost layer exists — add grain pricing + the P&L math (and maybe land cost/overhead) and the app fully replaces the $1,600/yr HP subscription. Highest-value next build. Trigger: after Galen validates the cost layer against real prices.
- **Forward-year pricing (budget before the season).** Season years are derived from imported application data (`fetchSeasonYears` reads `field_operations` where `operation_type='application'`), so you can't pre-set next year's input prices before any applications import. HP lets you navigate to a future year and pre-budget. Add via always-including the current calendar year, or a "+ add year". Galen decided 2026-06-03 it's fine for now ("first thing we do each season is an application"), but real budgeters often want this. Trigger: if pre-season budgeting becomes a workflow.
- **Set a product's purchase unit without entering a price.** Currently a per-product `price_unit` only persists when you save that product's price (they're set together in the row). Setting just the unit (independent of price) would need the per-product `price_unit_default` to be directly editable per row (it's currently only set via the bulk category tool). Raised 2026-06-03; Galen didn't request it. Trigger: if setting units ahead of prices becomes annoying.
- **Seed pricing + profit/multi-currency.** Explicit v2 parking from the pricing-layer design (`2026-06-01-product-pricing-cost-layer-design.md` non-goals): seed cost (per-bag/unit, seeding ops — reuses the same model), multi-currency (USD-only today). Trigger: when those input types matter.
- **Harvest Profit price import.** HP has an Export button; importing its price history would save re-keying years of input prices into the new pricing layer. Trigger: when populating historical-year prices.
- **Tillage operations sync** — `tillage` is already in `MEASUREMENT_TYPE_MAP` at `john-deere-import/index.ts:243-248` but excluded from the import loop. Once spray sync is solid, picking up tillage is essentially the same pattern. Trigger: once spray is in production and we want a full picture of field-level activity for the season.
- **Products dictionary normalization** — if the spray-sync build stores products as denormalized strings per application, a follow-up could extract a `products` catalog table (product name → manufacturer → category → label info) so we can answer "all herbicide passes" or "all glyphosate this year" without string matching. Trigger: once we have ~50+ application records and start asking those questions in the UI.

- **Cross-link spray data with Farm-Budget treatments** — Farm-Budget (sibling app in same Supabase project) has a `public.yield_records.treatments` JSONB column that appears to store manually-entered treatment data per yield record. After the OPS Center spray-sync ships, there's a natural question about whether to make these two data sources cross-reference (so a yield record can show "treatments per JD spray records" without manual entry). Defer until both data layers are stable. Triggered by: Farm-Budget patterns audit on 2026-05-28.
- **pgTAP database-level RLS test suite** — automated SQL tests that prove "user B cannot read user A's data" before every deploy. Skipped for v1 of spray-sync because: only one effective user (Galen), runtime `checkMutationResult` + manual second-account verification already cover the bug class, ~1 hr setup cost not justified yet. Trigger: when the app gains a second real user (Galen's wife, hired hand, multi-tenant rollout). Decided 2026-05-28.

## Parked (decided to NOT do — but keep the reasoning)

_None yet._
