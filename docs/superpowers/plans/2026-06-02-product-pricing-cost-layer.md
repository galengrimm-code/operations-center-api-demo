# Product Pricing & Cost Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set input prices per year on the Products page and surface per-acre input cost on applications and per field, with full unit conversion (weight/volume + cross-family via density).

**Architecture:** A year-keyed `product_prices` table plus a `density_lbs_per_gal` column on `products`. Two pure, unit-tested modules — `lib/unit-convert.ts` (unit math) and `lib/cost-calc.ts` (cost math) — do all the arithmetic; UI and data-fetch layers stay thin. Costs are always derived at read time (never stored), so editing a price live-updates every view. An application's price is selected by `(product_id, crop_season year)`.

**Tech Stack:** Next.js 13 App Router, React 18, TypeScript, Supabase (Postgres + RLS), Tailwind, shadcn/ui, Vitest (unit, TDD), Playwright (E2E). Supabase access via the established `(supabase.from("X") as any)` cast — the typed client only declares `john_deere_connections`.

**Spec:** `docs/superpowers/specs/2026-06-01-product-pricing-cost-layer-design.md`

---

## File Structure

```
supabase/migrations/
  20260602120000_create_product_prices_table.sql   # new table + RLS
  20260602120100_add_density_to_products.sql        # ALTER products

lib/
  unit-convert.ts                                   # NEW — pure unit converter
  cost-calc.ts                                      # NEW — pure cost math
  applications-client.ts                            # MODIFY — price CRUD + cost attachment

types/
  applications.ts                                   # MODIFY — Product.density, ProductPrice, cost fields

app/(app)/products/page.tsx                         # MODIFY — year selector, price entry, all-seasons avg
components/applications/
  products-rollup-table.tsx                         # MODIFY — Price / Unit / Density columns
  application-expanded.tsx                          # MODIFY — header $/ac total
  product-line-row.tsx                              # MODIFY — $/ac • $/unit per line
app/(app)/fields/[fieldId]/applications/page.tsx    # MODIFY — field per-acre cost summary + Actual/Spread toggle
components/applications/field-cost-summary.tsx      # NEW — the rollup card + toggle

lib/__tests__/unit-convert.test.ts                  # NEW
lib/__tests__/cost-calc.test.ts                     # NEW
tests/e2e/pricing.spec.ts                           # NEW
```

Known units (the only valid `price_unit` / line-unit tokens): weight `ozm`, `lb`, `ton`; volume `floz`, `pt`, `qt`, `gal`. `lib/unit-display.ts` already maps JD tokens (`floz1ac-1` → `floz/ac`) to labels — reuse it for display; the converter operates on the bare unit.

---

## Task 1: `product_prices` table + RLS

**Files:**

- Create: `supabase/migrations/20260602120000_create_product_prices_table.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Year-keyed input pricing. One price per product per crop-season year.
-- Cost is always derived at read time (price × converted quantity); never stored.
create table if not exists operations_center.product_prices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  org_id         text not null,
  product_id     uuid not null references operations_center.products(id) on delete cascade,
  year           integer not null,
  price_per_unit numeric not null check (price_per_unit >= 0),
  price_unit     text not null check (price_unit in ('ozm','lb','ton','floz','pt','qt','gal')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, org_id, product_id, year)
);

create index if not exists product_prices_lookup
  on operations_center.product_prices (user_id, org_id, year);

alter table operations_center.product_prices enable row level security;

create policy "own rows - select" on operations_center.product_prices
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on operations_center.product_prices
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on operations_center.product_prices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows - delete" on operations_center.product_prices
  for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply via Supabase MCP** (`apply_migration`, project `nuxofsjzrgdauzriraze`, name `create_product_prices_table`). Confirm the linked ref is `nuxofsjzrgdauzriraze` first.

- [ ] **Step 3: Verify** with `list_tables` (schema `operations_center`) — confirm `product_prices` exists with `rls_enabled: true` and the 4 policies.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602120000_create_product_prices_table.sql
git commit -m "feat(db): product_prices table (year-keyed) + RLS"
```

---

## Task 2: `density_lbs_per_gal` on products

**Files:**

- Create: `supabase/migrations/20260602120100_add_density_to_products.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Physical constant per product; powers weight<->volume cost conversion.
-- Null = product never crosses unit families (priced & applied in the same family).
alter table operations_center.products
  add column if not exists density_lbs_per_gal numeric check (density_lbs_per_gal is null or density_lbs_per_gal > 0);
```

- [ ] **Step 2: Apply** via `apply_migration` (name `add_density_to_products`).
- [ ] **Step 3: Verify** `list_tables` shows `density_lbs_per_gal` on `products`.
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602120100_add_density_to_products.sql
git commit -m "feat(db): products.density_lbs_per_gal for weight<->volume conversion"
```

---

## Task 3: `lib/unit-convert.ts` (pure converter, TDD)

**Files:**

- Create: `lib/unit-convert.ts`
- Test: `lib/__tests__/unit-convert.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/__tests__/unit-convert.test.ts
import { describe, it, expect } from "vitest";
import { convertAmount, unitFamily } from "../unit-convert";

describe("unitFamily", () => {
  it("classifies weight and volume", () => {
    expect(unitFamily("lb")).toBe("weight");
    expect(unitFamily("ton")).toBe("weight");
    expect(unitFamily("ozm")).toBe("weight");
    expect(unitFamily("gal")).toBe("volume");
    expect(unitFamily("floz")).toBe("volume");
    expect(unitFamily("qt")).toBe("volume");
    expect(unitFamily("pt")).toBe("volume");
    expect(unitFamily("bogus")).toBeNull();
  });
});

describe("convertAmount — same unit", () => {
  it("returns the value unchanged", () => {
    expect(convertAmount(5, "lb", "lb")).toBe(5);
  });
});

describe("convertAmount — within weight", () => {
  it("lb -> ozm", () => expect(convertAmount(1, "lb", "ozm")).toBeCloseTo(16, 6));
  it("ton -> lb", () => expect(convertAmount(1, "ton", "lb")).toBeCloseTo(2000, 6));
  it("lb -> ton", () => expect(convertAmount(2000, "lb", "ton")).toBeCloseTo(1, 6));
});

describe("convertAmount — within volume", () => {
  it("gal -> floz", () => expect(convertAmount(1, "gal", "floz")).toBeCloseTo(128, 6));
  it("floz -> gal", () => expect(convertAmount(128, "floz", "gal")).toBeCloseTo(1, 6));
  it("gal -> qt", () => expect(convertAmount(1, "gal", "qt")).toBeCloseTo(4, 6));
  it("gal -> pt", () => expect(convertAmount(1, "gal", "pt")).toBeCloseTo(8, 6));
});

describe("convertAmount — cross family via density", () => {
  it("gal -> lb uses density (lbs/gal)", () =>
    expect(convertAmount(1, "gal", "lb", 11.05)).toBeCloseTo(11.05, 6));
  it("lb -> gal is the inverse", () =>
    expect(convertAmount(11.05, "lb", "gal", 11.05)).toBeCloseTo(1, 6));
  it("floz -> ton via density", () =>
    expect(convertAmount(128, "floz", "ton", 2000)).toBeCloseTo(1, 6)); // 128 floz=1 gal; 1 gal*2000 lb/gal=2000 lb=1 ton
  it("returns null when density missing", () => expect(convertAmount(1, "gal", "lb")).toBeNull());
  it("returns null when density is zero/negative", () => {
    expect(convertAmount(1, "gal", "lb", 0)).toBeNull();
    expect(convertAmount(1, "gal", "lb", -2)).toBeNull();
  });
});

describe("convertAmount — unknown units", () => {
  it("returns null", () => {
    expect(convertAmount(1, "bogus", "lb")).toBeNull();
    expect(convertAmount(1, "lb", "bogus")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`module not found`)

Run: `npx vitest run lib/__tests__/unit-convert.test.ts`
Expected: FAIL (cannot resolve `../unit-convert`).

- [ ] **Step 3: Implement**

```ts
// lib/unit-convert.ts
// Pure unit conversion for input costing. Two families; cross-family needs density (lbs/gal).

export type UnitFamily = "weight" | "volume";

// factor = how many BASE units in one of this unit. weight base = lb, volume base = gal.
const WEIGHT: Record<string, number> = { ozm: 1 / 16, lb: 1, ton: 2000 };
const VOLUME: Record<string, number> = { floz: 1 / 128, pt: 1 / 8, qt: 1 / 4, gal: 1 };

export function unitFamily(unit: string): UnitFamily | null {
  if (unit in WEIGHT) return "weight";
  if (unit in VOLUME) return "volume";
  return null;
}

/**
 * Convert `value` from `from` to `to`. Same family uses fixed factors; cross-family
 * (weight<->volume) requires `densityLbsPerGal`. Returns null when conversion is
 * impossible (unknown unit, or cross-family without a usable density).
 */
export function convertAmount(
  value: number,
  from: string,
  to: string,
  densityLbsPerGal?: number | null,
): number | null {
  if (from === to) return value;
  const ff = unitFamily(from);
  const tf = unitFamily(to);
  if (!ff || !tf) return null;

  if (ff === tf) {
    const table = ff === "weight" ? WEIGHT : VOLUME;
    return (value * table[from]) / table[to];
  }

  // cross-family: need density
  if (!densityLbsPerGal || densityLbsPerGal <= 0) return null;
  if (ff === "weight") {
    const lb = value * WEIGHT[from];
    const gal = lb / densityLbsPerGal;
    return gal / VOLUME[to];
  } else {
    const gal = value * VOLUME[from];
    const lb = gal * densityLbsPerGal;
    return lb / WEIGHT[to];
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/__tests__/unit-convert.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/unit-convert.ts lib/__tests__/unit-convert.test.ts
git commit -m "feat(cost): unit converter (weight/volume + cross-family via density)"
```

> **Unit-vocabulary note (#8):** the converter's known units (`ozm`/`lb`/`ton`/`floz`/`pt`/`qt`/`gal`)
> are the source of truth for both line units and `price_unit`. JD's dry-ounce token is `ozm` (not
> `oz`); `lib/unit-display.ts` knows `oz`, so when displaying a `price_unit`/`total_unit` add an
> `ozm → "oz"` label mapping (display only — the stored/compared token stays `ozm`). The price-unit
> `<select>` in Task 7 offers exactly these 7 tokens. Metric volume (`l`/`ml`/`kg`) is absent from
> the real data and intentionally unsupported in v1 — a line in an unknown unit yields `cost = null`
> ("—"), never a silent wrong number.

---

## Task 4: `lib/cost-calc.ts` (pure cost math, TDD)

**Files:**

- Create: `lib/cost-calc.ts`
- Test: `lib/__tests__/cost-calc.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/__tests__/cost-calc.test.ts
import { describe, it, expect } from "vitest";
import {
  lineTotalCost,
  acresFrom,
  costPerAcre,
  fieldCostPerAcre,
  type PriceRef,
  type CostLine,
} from "../cost-calc";

const potash: PriceRef = { price_per_unit: 420, price_unit: "ton", density_lbs_per_gal: null };

// IMPORTANT: cost derives from the line's TOTAL (bare `total_unit`, e.g. "lb"), NOT the
// rate (whose `rate_unit` is a JD token like "lb1ac-1"). total_value is JD-authoritative.
describe("lineTotalCost", () => {
  it("converts total into price unit then multiplies (ton priced, lb applied)", () => {
    // 6286 lb total at $420/ton = 6286/2000 ton * 420 = $1320.06
    expect(lineTotalCost(6286, "lb", potash)).toBeCloseTo(1320.06, 1);
  });
  it("volume->volume (gal priced, floz applied)", () => {
    // 128 floz total at $30/gal => 1 gal * 30 = $30
    const p: PriceRef = { price_per_unit: 30, price_unit: "gal", density_lbs_per_gal: null };
    expect(lineTotalCost(128, "floz", p)).toBeCloseTo(30, 6);
  });
  it("cross-family uses density (ton priced, gal applied)", () => {
    // 1 gal, density 11.05 lb/gal, $600/ton => 11.05/2000 ton * 600 = $3.315
    const p: PriceRef = { price_per_unit: 600, price_unit: "ton", density_lbs_per_gal: 11.05 };
    expect(lineTotalCost(1, "gal", p)).toBeCloseTo(3.315, 3);
  });
  it("returns null when no price ref", () => {
    expect(lineTotalCost(5, "lb", null)).toBeNull();
  });
  it("returns null when total or unit missing", () => {
    expect(lineTotalCost(null, "lb", potash)).toBeNull();
    expect(lineTotalCost(5, null, potash)).toBeNull();
  });
  it("returns null when cross-family and density missing", () => {
    const p: PriceRef = { price_per_unit: 600, price_unit: "ton", density_lbs_per_gal: null };
    expect(lineTotalCost(1, "gal", p)).toBeNull();
  });
});

describe("acresFrom", () => {
  it("ac passes through", () => expect(acresFrom(135.61, "ac")).toBeCloseTo(135.61, 4));
  it("ha -> ac (×2.47105)", () => expect(acresFrom(10, "ha")).toBeCloseTo(24.7105, 3));
  it("null/unknown unit -> null (never silently treat as acres)", () => {
    expect(acresFrom(10, null)).toBeNull();
    expect(acresFrom(10, "bogus")).toBeNull();
  });
});

describe("costPerAcre", () => {
  it("total cost / applied acres", () => {
    expect(costPerAcre(1320.06, 135.6144)).toBeCloseTo(9.734, 3);
  });
  it("null total -> null", () => {
    expect(costPerAcre(null, 100)).toBeNull();
  });
  it("zero/null acres -> null (NOT 0 — unknown, not free)", () => {
    expect(costPerAcre(100, 0)).toBeNull();
    expect(costPerAcre(100, null)).toBeNull();
  });
});

describe("fieldCostPerAcre", () => {
  const lines: CostLine[] = [
    { totalCost: 100, appliedAcres: 10 }, // spot spray on 10 of 150
    { totalCost: 300, appliedAcres: 150 }, // full field
  ];
  it("actual basis = sum of per-applied-acre costs", () => {
    // 100/10 + 300/150 = 10 + 2 = 12
    expect(fieldCostPerAcre(lines, "actual", 150)).toBeCloseTo(12, 6);
  });
  it("spread basis = total dollars / field acres", () => {
    // (100 + 300) / 150 = 2.667
    expect(fieldCostPerAcre(lines, "spread", 150)).toBeCloseTo(2.667, 3);
  });
  it("skips lines with null totalCost", () => {
    const withNull: CostLine[] = [...lines, { totalCost: null, appliedAcres: 50 }];
    expect(fieldCostPerAcre(withNull, "spread", 150)).toBeCloseTo(2.667, 3);
  });
  it("actual skips lines with non-positive appliedAcres (unknown, not 0)", () => {
    const withBad: CostLine[] = [...lines, { totalCost: 99, appliedAcres: 0 }];
    expect(fieldCostPerAcre(withBad, "actual", 150)).toBeCloseTo(12, 6); // bad line excluded, not +0
  });
  it("spread with zero/invalid field acres -> null (NOT 0 — unknown)", () => {
    expect(fieldCostPerAcre(lines, "spread", 0)).toBeNull();
  });
  it("all-null lines -> null (nothing priced), not 0", () => {
    expect(fieldCostPerAcre([{ totalCost: null, appliedAcres: 10 }], "spread", 150)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/__tests__/cost-calc.test.ts`
Expected: FAIL (cannot resolve `../cost-calc`).

- [ ] **Step 3: Implement**

```ts
// lib/cost-calc.ts
// Pure cost math. Costs are derived, never stored.
import { convertAmount, unitFamily } from "./unit-convert";

export interface PriceRef {
  price_per_unit: number;
  price_unit: string;
  density_lbs_per_gal: number | null;
}

export interface CostLine {
  totalCost: number | null;
  appliedAcres: number;
}

export type FieldBasis = "actual" | "spread";

/**
 * Total dollars for one product line. Derives from the line's TOTAL applied quantity
 * (`total_value` in bare `total_unit`, e.g. "lb") — NOT the rate (whose `rate_unit` is a
 * JD token like "lb1ac-1"). null when no price or conversion is impossible.
 */
export function lineTotalCost(
  totalValue: number | null,
  totalUnit: string | null,
  price: PriceRef | null,
): number | null {
  if (price == null || totalValue == null || totalUnit == null) return null;
  const amountInPriceUnit = convertAmount(
    totalValue,
    totalUnit,
    price.price_unit,
    price.density_lbs_per_gal,
  );
  if (amountInPriceUnit == null) return null;
  return amountInPriceUnit * price.price_per_unit;
}

const HA_TO_AC = 2.4710538147;

/** Normalize an area value+unit to acres. Returns null for null/unknown units — never assume acres. */
export function acresFrom(value: number | null, unit: string | null): number | null {
  if (value == null) return null;
  if (unit === "ac") return value;
  if (unit === "ha") return value * HA_TO_AC;
  return null; // unknown unit: cost not computable, do not guess
}

/** $/ac for one line = total dollars / acres covered. null total or non-positive/null acres -> null. */
export function costPerAcre(totalCost: number | null, appliedAcres: number | null): number | null {
  if (totalCost == null || appliedAcres == null || appliedAcres <= 0) return null;
  return totalCost / appliedAcres;
}

/**
 * Field per-acre input cost. Returns null when nothing is priced or the denominator is invalid
 * (null = "unknown", rendered as "—"; never a fabricated 0).
 *  - "actual": Σ (lineTotalCost / lineAppliedAcres) over lines with positive acres.
 *  - "spread": Σ lineTotalCost / fieldAcres.
 * Lines with null totalCost or non-positive appliedAcres are excluded (not summed as 0).
 */
export function fieldCostPerAcre(
  lines: CostLine[],
  basis: FieldBasis,
  fieldAcres: number,
): number | null {
  const priced = lines.filter((l) => l.totalCost != null && l.appliedAcres > 0) as Array<{
    totalCost: number;
    appliedAcres: number;
  }>;
  if (priced.length === 0) return null;
  if (basis === "actual") {
    return priced.reduce((sum, l) => sum + l.totalCost / l.appliedAcres, 0);
  }
  if (fieldAcres <= 0) return null;
  return priced.reduce((sum, l) => sum + l.totalCost, 0) / fieldAcres;
}

/** convenience: a known unit guard for UI (re-export). */
export { unitFamily };
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/__tests__/cost-calc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cost-calc.ts lib/__tests__/cost-calc.test.ts
git commit -m "feat(cost): line + field cost math (actual/spread basis)"
```

---

## Task 5: Types + price CRUD in the client

**Files:**

- Modify: `types/applications.ts`
- Modify: `lib/applications-client.ts`

- [ ] **Step 1: Extend types**

In `types/applications.ts`, add `density_lbs_per_gal: number | null;` to `Product`, and add:

```ts
export interface ProductPrice {
  id: string;
  user_id: string;
  org_id: string;
  product_id: string;
  year: number;
  price_per_unit: number;
  price_unit: string;
  created_at: string;
  updated_at: string;
}

// per-line derived cost, attached at fetch time.
// null fields mean "unknown" (unpriced / unconvertible / bad area) and render as "—", never $0.00.
export interface LineCost {
  cost_per_acre: number | null;
  total_cost: number | null;
  price_per_unit: number | null;
  price_unit: string | null;
  needs_density: boolean; // cross-family with no density set
}
```

Extend the product-line shape in `ApplicationWithLines.product_lines[]` to optionally carry
`cost?: LineCost` and `applied_acres?: number | null` (normalized acres from Task 6).

- [ ] **Step 2: Add price CRUD functions** to `lib/applications-client.ts`

```ts
export async function fetchProductPrices(year: number, orgId: string): Promise<ProductPrice[]> {
  const { data, error } = await (supabase.from("product_prices") as any)
    .select("*")
    .eq("year", year)
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as ProductPrice[];
}

// Years that actually have application data (drives the year selector — no hardcoded list).
export async function fetchSeasonYears(orgId: string): Promise<number[]> {
  const { data, error } = await (supabase.from("field_operations") as any)
    .select("crop_season")
    .eq("org_id", orgId)
    .eq("operation_type", "application");
  if (error) throw error;
  const years = new Set<number>();
  for (const r of (data ?? []) as any[]) {
    if (/^\d{4}$/.test(String(r.crop_season ?? ""))) years.add(Number(r.crop_season));
  }
  return Array.from(years).sort((a, b) => b - a); // newest first
}

// average price_per_unit per product across all years (for "All seasons", read-only).
// Only averages rows that share the product's modal price_unit to avoid mixing units.
export async function fetchProductPriceAverages(
  orgId: string,
): Promise<Map<string, { avg: number; unit: string }>> {
  const { data, error } = await (supabase.from("product_prices") as any)
    .select("product_id, price_per_unit, price_unit")
    .eq("org_id", orgId);
  if (error) throw error;
  const byProduct = new Map<string, { sums: Map<string, { total: number; n: number }> }>();
  for (const r of (data ?? []) as any[]) {
    const e = byProduct.get(r.product_id) ?? { sums: new Map() };
    const s = e.sums.get(r.price_unit) ?? { total: 0, n: 0 };
    s.total += Number(r.price_per_unit);
    s.n += 1;
    e.sums.set(r.price_unit, s);
    byProduct.set(r.product_id, e);
  }
  const out = new Map<string, { avg: number; unit: string }>();
  for (const [pid, e] of byProduct) {
    // pick the unit with the most rows; average within it
    let best: { unit: string; total: number; n: number } | null = null;
    for (const [unit, s] of e.sums) if (!best || s.n > best.n) best = { unit, ...s };
    if (best) out.set(pid, { avg: best.total / best.n, unit: best.unit });
  }
  return out;
}

export async function upsertProductPrice(input: {
  productId: string;
  orgId: string;
  year: number;
  pricePerUnit: number;
  priceUnit: string;
}): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("not authenticated");
  const { error } = await (supabase.from("product_prices") as any).upsert(
    {
      user_id: userId,
      org_id: input.orgId,
      product_id: input.productId,
      year: input.year,
      price_per_unit: input.pricePerUnit,
      price_unit: input.priceUnit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,org_id,product_id,year" },
  );
  if (error) throw error;
}

export async function setProductDensity(productId: string, density: number | null): Promise<void> {
  const { error } = await (supabase.from("products") as any)
    .update({ density_lbs_per_gal: density, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) throw error;
}

// Bulk-copy a year's prices into another year (HP "Inputs Copy"). Does not overwrite existing.
export async function copyPricesFromYear(
  fromYear: number,
  toYear: number,
  orgId: string,
): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("not authenticated");
  // org-scoped on BOTH sides — never copy another org's price onto this org's product.
  const src = await fetchProductPrices(fromYear, orgId);
  const existing = new Set((await fetchProductPrices(toYear, orgId)).map((p) => p.product_id));
  const rows = src
    .filter((p) => !existing.has(p.product_id))
    .map((p) => ({
      user_id: userId,
      org_id: orgId,
      product_id: p.product_id,
      year: toYear,
      price_per_unit: p.price_per_unit,
      price_unit: p.price_unit,
    }));
  if (rows.length === 0) return 0;
  const { error } = await (supabase.from("product_prices") as any).insert(rows);
  if (error) throw error;
  return rows.length;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add types/applications.ts lib/applications-client.ts
git commit -m "feat(pricing): product_prices CRUD + averages + copy-year + density setter"
```

---

## Task 6: Attach per-line cost in `fetchApplications`

**Files:**

- Modify: `lib/applications-client.ts` (the `fetchApplications` reshape block)

- [ ] **Step 1: Load prices for the years present, then attach `cost` to each line.**

After the existing field-name resolution in `fetchApplications`, before the final `.map(...)`:

```ts
// Prices for every (product, year) touched by the result set.
const years = Array.from(
  new Set(
    (data ?? []).map((r: any) => Number(r.crop_season)).filter((y: number) => Number.isFinite(y)),
  ),
);
let priceRows: any[] = [];
if (years.length > 0) {
  const { data: pData, error: pErr } = await (supabase.from("product_prices") as any)
    .select("*")
    .in("year", years);
  if (pErr) throw pErr; // do NOT swallow: a load failure must not masquerade as "everything unpriced"
  priceRows = pData ?? [];
}
// key: `${product_id}:${year}` -> { price_per_unit, price_unit }
const priceByKey = new Map<string, { price_per_unit: number; price_unit: string }>(
  priceRows.map((p: any) => [`${p.product_id}:${p.year}`, p]),
);
```

Inside the `.map((row) => ...)` reshape, compute each line's cost from `total_value` + bare
`total_unit` (import `lineTotalCost`, `costPerAcre` from `./cost-calc`, `unitFamily` from
`./unit-convert`):

```ts
// crop_season is a 4-digit year string in real data; guard non-numeric so a bad value
// drops to "unpriced" deterministically rather than NaN-keying.
const yearNum = /^\d{4}$/.test(String(row.crop_season ?? "")) ? Number(row.crop_season) : null;
const product_lines = (row.product_lines ?? []).map((l: any) => {
  const price = yearNum != null ? (priceByKey.get(`${l.product_id}:${yearNum}`) ?? null) : null;
  const density = l.product?.density_lbs_per_gal ?? null;
  const priceRef = price ? { ...price, density_lbs_per_gal: density } : null;
  const total = lineTotalCost(l.total_value, l.total_unit, priceRef);
  const acres = acresFrom(l.area_value ?? null, l.area_unit ?? null);
  const cpa = costPerAcre(total, acres);
  const needs_density =
    !!price && total === null && unitFamily(l.total_unit) !== unitFamily(price.price_unit);
  return {
    ...l,
    applied_acres: acres, // normalized acres (ac or ha->ac), reused by the field rollup
    cost: {
      cost_per_acre: cpa,
      total_cost: total,
      price_per_unit: price?.price_per_unit ?? null,
      price_unit: price?.price_unit ?? null,
      needs_density,
    },
  };
});
return { ...row, field_name: ..., farm_name: ..., product_lines };
```

> Confirmed against real data: `total_unit` is the bare unit (`lb`, `floz`, `gal`, …) while
> `rate_unit` is a JD token (`lb1ac-1`). Cost derives from `total_value`/`total_unit` (no token
> parsing, JD-authoritative). Area is normalized via `acresFrom(area_value, area_unit)` — today all
> rows are `ac`, but `ha` is possible and must convert, not divide raw. Import `acresFrom` from
> `./cost-calc`.

- [ ] **Step 2: Add a unit test** for the year-keying in `lib/__tests__/cost-calc.test.ts` is N/A (this is glue) — instead verify via the E2E in Task 11. Typecheck now:

Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/applications-client.ts
git commit -m "feat(pricing): attach derived per-line cost to fetchApplications"
```

---

## Task 7: Products page — year selector, price entry, all-seasons average

**Files:**

- Modify: `app/(app)/products/page.tsx`
- Modify: `components/applications/products-rollup-table.tsx`

- [ ] **Step 1: Products page — add year state + load prices.**

Load real season years via `fetchSeasonYears(orgId)` (no hardcoded list — #10). Default `year` to the
newest returned (fallback: current calendar year). Add an `"all"` sentinel for All-seasons. Load
`fetchProductPrices(year, orgId)` for a specific year, or `fetchProductPriceAverages(orgId)` when
"all". Pass a `priceByProduct` map + an `allSeasons` flag into `ProductsRollupTable`. Wire
`upsertProductPrice` / `setProductDensity` / `copyPricesFromYear` handlers (reload on success).

> Replace the existing hardcoded `[2026,2025,2024]` season `<select>` in this file with the
> data-driven year list from `fetchSeasonYears` (the season filter and the price-year selector
> should share it). This fixes the pre-existing hardcoded-years shortcut, not just avoid adding a new one.

Header gains a year `<select>` (`[color-scheme:dark]`, options = `fetchSeasonYears` result + "All
seasons") and, when a specific year is selected, a **"Copy from {year-1}"** button calling
`copyPricesFromYear(year-1, year, orgId)` then reload (button shown only when `year-1` is in the
season list, so you can't copy from a year with no data).

- [ ] **Step 2: Rollup table — add Price / Unit / Density columns.**

In `products-rollup-table.tsx`, accept new props: `priceByProduct: Map<string,{price_per_unit:number;price_unit:string}>`, `densityByProduct: Map<string,number|null>` (from the product rows), `allSeasons: boolean`, `avgByProduct?: Map<string,{avg:number;unit:string}>`, and handlers `onSetPrice(productId, value, unit)`, `onSetDensity(productId, value)`.

Add columns after Category:

- **Price**: when `allSeasons` → read-only text `avg.toFixed(2)` (or "—"); else editable number input + a unit `<select>` (`ozm/lb/ton/floz/pt/qt/gal`, default = product's observed unit or existing price unit). On blur/change → `onSetPrice`.
- **Density**: editable number (`lbs/gal`); show a subtle "set density" hint styling when null. On blur → `onSetDensity`.

Keep existing sortable headers; add `price` to the `SortKey` union (sort by `priceByProduct.get(id)?.price_per_unit ?? -1`).

- [ ] **Step 3: Verify (Playwright smoke)** — covered in Task 11. Typecheck + lint now:

Run: `npm run typecheck && npm run lint` → PASS / no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/page.tsx" components/applications/products-rollup-table.tsx
git commit -m "feat(pricing): set price/unit/density per year on Products + all-seasons average"
```

---

## Task 8: Application line cost display

**Files:**

- Modify: `components/applications/product-line-row.tsx`
- Modify: `components/applications/application-expanded.tsx`
- Modify: `components/applications/application-row.tsx` (collapsed header total)

- [ ] **Step 1: Product line row — show `$/ac • $/unit`.**

In `product-line-row.tsx`, read `line.cost`. Render in the cost area:

- if `cost.cost_per_acre != null`: `` `$${cost.cost_per_acre.toFixed(2)}/ac • $${cost.price_per_unit!.toFixed(2)}/${displayUnit(cost.price_unit)}` ``
- else if `cost.needs_density`: amber "set density" text linking to /products
- else: muted **`—`** (no price set — unknown, NOT `$0.00`; #6). `$0.00` is reserved for a real $0 price.

- [ ] **Step 2: Expanded + collapsed header — application $/ac total.**

In `application-expanded.tsx` (and the collapsed `application-row.tsx` total slot), compute `sum of line.cost.cost_per_acre` (treating null as 0) and render `$X.XX/ac`. Add a tiny helper in `lib/cost-calc.ts`:

```ts
export function applicationCostPerAcre(
  lines: Array<{ cost?: { cost_per_acre: number | null } }>,
): number {
  return lines.reduce((s, l) => s + (l.cost?.cost_per_acre ?? 0), 0);
}
```

(Add a test for `applicationCostPerAcre` in `cost-calc.test.ts`: two lines 9.73 + 2.0 → 11.73; null line ignored.)

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` → PASS.

```bash
git add components/applications/ lib/cost-calc.ts lib/__tests__/cost-calc.test.ts
git commit -m "feat(pricing): per-line \$/ac • \$/unit + application \$/ac total"
```

---

## Task 9: Field per-acre cost summary + Actual/Spread toggle

**Files:**

- Create: `components/applications/field-cost-summary.tsx`
- Modify: `app/(app)/fields/[fieldId]/applications/page.tsx`

- [ ] **Step 1: Build `FieldCostSummary`.**

Props: `rows: ApplicationWithLines[]` (the field's applications, already cost-attached), `fieldAcres: number` (already normalized to acres by the caller). Local `basis` state (`"spread" | "actual"`, default `"spread"`). Flatten every line into `CostLine[] = { totalCost: line.cost.total_cost, appliedAcres: line.applied_acres ?? 0 }` (use the normalized `applied_acres` attached in Task 6, NOT raw `area_value`). Call `fieldCostPerAcre(lines, basis, fieldAcres)` for the headline number; render `"—"` when it returns `null` (unpriced / unknown), never `$0.00`.

**Per-category breakdown — same basis formula per group (#4 fix):** group the flattened lines by effective category, then for each group call `fieldCostPerAcre(groupLines, basis, fieldAcres)`. Do NOT sum category dollars and divide once — for `actual` that double-counts mixed-acre lines. Categories whose group returns `null` show "—". Show a footnote when any line `cost.needs_density` ("N inputs need a density set to price") and another when any line is unpriced ("N inputs have no {year} price set").

- [ ] **Step 2: Wire into the field applications page.**

Read the field's boundary acres from the `fields` row and normalize: `acresFrom(boundary_area_value, boundary_area_unit)` (import from `lib/cost-calc`). `boundary_area_unit` can be `ha` just like line area — same ~2.47× trap. If it returns null, pass 0 (the summary will render spread as "—"). Render `<FieldCostSummary rows={rows} fieldAcres={acres ?? 0} />` above the per-field applications list.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint` → clean.

```bash
git add components/applications/field-cost-summary.tsx "app/(app)/fields/[fieldId]/applications/page.tsx"
git commit -m "feat(pricing): field per-acre input cost summary with actual/spread toggle"
```

---

## Task 10: Full unit-test gate

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run prebuild`
Expected: typecheck clean, all Vitest tests PASS (existing 47 + new unit-convert/cost-calc cases).

- [ ] **Step 2: Fix any regressions** (none expected — all additions are new files/columns).

---

## Task 11: E2E verification (Playwright) + manual data check

**Files:**

- Create: `tests/e2e/pricing.spec.ts`

- [ ] **Step 1: Write a seed-data E2E** (test user has the seed product/op). Steps: go to `/products`, pick a year, set a price + unit on the seed product, reload, assert it persisted; switch to "All seasons", assert the price cell is read-only; go to `/applications`, expand the seed application, assert a `$/ac` value renders on the line and a total on the header. Use the auth.setup storageState.

- [ ] **Step 2: Run** `npx playwright test pricing --project=chromium` → PASS.

- [ ] **Step 3: Real-data sanity (MCP, read-only).** After the build is deployed and Galen sets a couple real prices, spot-check via `execute_sql`: pick one application line, compute expected cost by hand from **`total_value` + `total_unit`** (NOT `rate_value`/`rate_unit` — those are the tokenized rate), the price (`price_per_unit`/`price_unit`), and `density_lbs_per_gal` if cross-family; then `$/ac = total_cost / acresFrom(area_value, area_unit)`. Confirm the UI matches. Include at least one cross-family case (priced $/ton, applied in gal) and verify a no-price line shows "—", not $0.00. (Galen-in-the-loop, like the import verification.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pricing.spec.ts
git commit -m "test(e2e): pricing entry + application cost display"
```

---

## Self-Review notes

- **Spec coverage:** year-keyed prices (T1), density (T2), converter incl. cross-family (T3), line+field cost incl. actual/spread (T4), CRUD+averages+copy-year (T5), application attach (T6), Products UI + all-seasons average (T7), application $/ac display (T8), field rollup + toggle (T9), tests (T10–11). All spec sections mapped.
- **Graceful states:** unpriced → "—" (NOT $0.00); cross-family no density → "set density" (T6 `needs_density`, surfaced T8/T9); bad/zero denominator → "—".
- **Resolved (data-checked):** `total_unit` is bare (`lb`/`floz`/`gal`); `rate_unit` is a JD token (`lb1ac-1`). Cost derives from `total_value`/`total_unit` — no token parsing, JD-authoritative total. Verified on real rows (Lime 696,134 lb / 139.23 ac, etc.).

### Codex review (gpt-5.4, 2026-06-02) — findings folded in

- **#1 spec/verify cited rate_value** → fixed spec Cost-computation section + T11 verification to use `total_value`/`total_unit`.
- **#2 `area_value` assumed acres** (real bug — `ha` would be ~2.47× wrong) → added `acresFrom(value,unit)` in T4; T6 attaches normalized `applied_acres`; T9 normalizes field acres. Data today is 100% `ac`, but the guard prevents a silent future error.
- **#3 cross-org price→product** → `fetchProductPrices`/averages/`copyPricesFromYear` all org-scoped (T5).
- **#4 category breakdown actual basis** → per-group `fieldCostPerAcre(groupLines, basis, …)`, never sum-dollars-then-divide (T9).
- **#5/#6 fabricated zeros** → `fieldCostPerAcre`/`costPerAcre` return `null` (not 0) for empty/invalid; UI renders "—". $0.00 only for a real $0 price.
- **#7 `Number(crop_season)`** → guarded with `/^\d{4}$/` test (T6); all 1,013 rows are clean today.
- **#8 `ozm` vs `oz` / metric** → converter unit-set is source of truth; add `ozm→"oz"` display label; unknown units → null (T3 note). No metric in real data.
- **#9 swallowed price-load error** → T6 now `throw pErr` instead of `?? []`.
- **#10 hardcoded year list** → `fetchSeasonYears(orgId)` drives the selector; replaces the existing hardcoded `[2026,2025,2024]` (T5/T7).
- **Data verification (2026-06-02):** 100% `area_unit='ac'`, 100% 4-digit `crop_season` — so #2/#7 don't bite current data, but guards added for safety.
