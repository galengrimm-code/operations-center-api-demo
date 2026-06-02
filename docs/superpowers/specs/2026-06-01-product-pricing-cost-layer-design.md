# Product Pricing & Cost Layer — Design

**Date:** 2026-06-01
**Status:** Design — pending Codex review + implementation plan
**Goal:** Add input pricing to the products catalog and flow per-acre input cost into the
applications/field views — the cost layer reserved in the 2026-05-28 spray-sync spec, built to
displace Harvest Profit's cost tracking.

---

## Why

Galen pays ~$1,600/yr for Harvest Profit primarily for input cost tracking. The spray-application
sync already imports every product line with its applied quantity (`field_operation_products`).
The only missing piece is **price** — once a per-unit price exists for a product in a given year,
we can compute `$/ac` for every application line and roll it up per field. This is the feature
that lets Farm Data Hub replace Harvest Profit's day-to-day use.

**User-stated goals:**
- Set input prices under **Products**, scoped **by year**.
- See **`$/ac`** per product on each application (like HP's `$X.XX/ac • $Y.YY/unit`).
- Pull up a field (e.g. "East of Falls City", "Myers East") and see **per-acre input cost**.

## Non-goals (v1)

- Multi-currency (USD assumed).
- Automated price feeds / retailer integration (manual entry, with year-to-year copy).
- Seed cost (focus is fertilizer + chemical; seed can reuse the same model later).
- Revenue / profit / overhead (HP's broader P&L) — cost layer only.

---

## Data model

### `operations_center.product_prices` (new)

```
id                 uuid PK default gen_random_uuid()
user_id            uuid  not null  -> auth.users
org_id             text  not null
product_id         uuid  not null  -> operations_center.products(id) on delete cascade
year               int   not null              -- crop-season year the price applies to
price_per_unit     numeric not null            -- e.g. 420.00
price_unit         text  not null              -- one of the known units (ton, lb, ozm, gal, qt, pt, floz)
created_at         timestamptz default now()
updated_at         timestamptz default now()
UNIQUE (user_id, org_id, product_id, year)
```

- **Year, not effective_date.** Supersedes the `product_price_events(effective_date, ...)` sketch
  in the spray-sync spec. Matches HP's year selector and the application's `crop_season`.
- One price per product per year. Editing re-uses the row (upsert on the unique key).
- **RLS on creation day** (per project security rules): users see/write only their own rows
  (`user_id = auth.uid()`), mirroring the existing `products` policies.

### `operations_center.products` (alter)

```
+ density_lbs_per_gal  numeric null   -- "Liquid Density", powers weight<->volume conversion
```

- Physical constant per product (year-independent), so it lives on `products`, not `product_prices`.
- Only required when a product's **price unit family differs from its applied unit family**
  (e.g. priced `$/ton`, applied in `gal`). Null is fine for products that never cross families.

---

## Unit conversion

A small pure module (`lib/unit-convert.ts`), unit-tested (TDD), with two families:

| Family | Units | Base | Fixed factors |
|---|---|---|---|
| Weight | `ozm`, `lb`, `ton` | lb | 1 lb = 16 ozm; 1 ton = 2000 lb |
| Volume | `floz`, `pt`, `qt`, `gal` | gal | 1 gal = 128 floz = 8 pt = 4 qt |

**Cross-family (weight ↔ volume)** uses the product's `density_lbs_per_gal`:
`lb = gal × density` (and inverse). Convert volume→gal (fixed), gal→lb via density, lb→target
weight (fixed), and vice-versa.

```
convertAmount(value, fromUnit, toUnit, densityLbsPerGal?) -> number | null
```

Returns `null` when conversion is impossible (cross-family with no density). Callers treat `null`
as "cost not computable" and surface a graceful prompt rather than a wrong number.

> Unit tokens: JD `rate_unit` values look like `floz1ac-1` (= floz/ac); `total_unit` is the bare
> unit (`floz`, `gal`, `lb`, `ozm`, `qt`, `pt`). The converter operates on the bare unit; the
> existing `lib/unit-display.ts` already maps tokens to labels.

---

## Cost computation

Pure module (`lib/cost-calc.ts`), unit-tested. Cost derives from the line's **total applied
quantity** (`total_value` in the bare `total_unit`, e.g. `lb`/`floz`/`gal`) — NOT the rate
(`rate_unit` is a JD token like `lb1ac-1`). `total_value` is JD-authoritative.

```
lineTotalCost  = convertAmount(total_value, total_unit, price_unit, density) × price_per_unit
lineCostPerAcre = lineTotalCost / appliedAcres            // appliedAcres = acres(area_value, area_unit)
```

- **Area is normalized to acres first.** `area_unit` can be `ac` or `ha` (the app already renders
  `ha`). `appliedAcres = area_value` when `ac`, `area_value × 2.47105` when `ha`. Dividing by a raw
  hectare value would understate $/ac by ~2.47×. Unknown area unit → cost not computable (null).
- **Price selection:** a line's price = `product_prices` row for `(product_id, application.crop_season year)`.
  No row → price unknown → `cost = null` (renders as "—"/unpriced, **not** `$0.00`).
- **No density when needed:** `convertAmount` returns null → line shows "set density", `cost = null`.
- **Null vs zero:** `null` means "unknown" (unpriced, unconvertible, bad denominator) and renders
  "—"; a genuine `$0.00` only appears when a real $0 price is set. Aggregates exclude null lines.
- **Application total** (`$/ac`) = sum of priced line `$/ac` (nulls excluded).

### Field-level rollup — Actual vs Spread toggle

For a field's per-acre input cost, a partial-field application (e.g. 10 ac sprayed on a 150 ac
field) can be expressed two ways. The field view exposes a toggle (HP's "Imported Machine Rate"
equivalent):

- **Actual** (per applied acre): `Σ (lineTotalCost / lineAppliedAcres)` — what it cost on the
  ground covered. **Per-line division, summed** — never sum dollars then divide once (mixed-acre
  lines would give a wrong number).
- **Spread** (per field acre): `Σ lineTotalCost / field_acres` — what it adds to the whole field's
  per-acre cost. This is the "$1/ac across 150 ac" number for true field cost.

Both derive from the same stored data (`lineTotalCost`, normalized applied acres, field acres —
field acres also normalized from `boundary_area_value`/`boundary_area_unit`). The **per-category
breakdown uses the same basis formula per group** (so "actual" sums per-line $/ac within the
category, not category-dollars ÷ once). Lines with `null` cost are excluded from both bases.
`field_acres ≤ 0` → spread is `null` ("—"), not `0`. Application **detail lines** always show
applied-acre; only the **field rollup** honors the toggle.

---

## UI

### Products page (pricing entry)

- **Year selector** in the header (defaults to the latest year present in the data; arrows or
  dropdown). Drives which year's prices are shown/edited.
- Per-product row gains: **Price** (editable number) + **unit** (dropdown of known units, defaults
  to the product's observed application unit) + **Density** (editable, shown/relevant when the
  price unit crosses families; "Set density" affordance otherwise). Sits alongside the existing
  category dropdown.
- **"Copy prices from {year-1}"** action — bulk-seed this year from last year (HP "Inputs Copy"),
  so annual setup isn't manual per product.
- **All seasons selected** → price column shows the **average across years, read-only** (editing
  requires a specific year). Resolves the all-seasons ambiguity.
- Existing **category filter, sortable headers, farm filter** continue to apply.

### Applications view

- Expanded product line: append **`$X.XX/ac • $Y.YY/unit`** in the existing Cost/Rate area (fills
  the cost/ac placeholder reserved in the spray-sync spec).
- Application header: total **`$/ac`** (sum of line $/ac).
- Graceful: no price → `$0.00/ac • $0.00/unit`; cross-family no density → "set density".

### Field view (per-acre input cost)

- A per-field summary showing **total input `$/ac`** (and a per-product or per-category breakdown),
  with the **Actual / Spread** toggle. Reachable from the field detail / applications-by-field
  surface. This is the "pull up Myers East, see $/ac inputs" deliverable.

---

## Testing

This project now has Vitest. Cost math is the bug-prone core, so:

- **Unit tests (TDD):** `unit-convert` (every family pair, cross-family with/without density,
  null cases) and `cost-calc` (line $/ac, line total, application total, Actual vs Spread,
  missing-price, missing-density). Use real product examples from the imported data
  (potash $/ton→lb, a $/gal chemical applied in floz, a $/ton liquid needing density).
- **Component/E2E (Playwright):** price entry persists per year; all-seasons shows average;
  application line renders `$/ac`; field rollup toggle flips the number.

---

## Edge cases / graceful degradation

- **No price for (product, year):** `$0.00/ac`, excluded from "priced" totals (never blocks).
- **Cross-family, no density:** "Set density" prompt, $0 contribution until set.
- **Variable-rate / multiple sub-area lines** (seen in real data: same product, different acres):
  each line computes independently; field rollup sums line totals then divides per the toggle.
- **Years with no data:** year selector only offers years present (plus current year for entry).
- **Editing a price** recomputes all displayed costs for that year (no stored cost — always derived).

---

## Open questions / deferred

- **Seed pricing** (per-bag/per-unit, seeding ops) — same model, separate phase.
- **Price history / audit** beyond one-per-year — not needed; year granularity is the unit.
- **Currency** — USD only for now.
