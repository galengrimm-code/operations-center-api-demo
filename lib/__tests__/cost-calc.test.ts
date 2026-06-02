// lib/__tests__/cost-calc.test.ts
import { describe, it, expect } from "vitest";
import {
  lineTotalCost,
  acresFrom,
  costPerAcre,
  fieldCostPerAcre,
  applicationCostPerAcre,
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

describe("applicationCostPerAcre", () => {
  it("sums line cost_per_acre, ignoring nulls", () => {
    const lines = [
      { cost: { cost_per_acre: 9.73 } },
      { cost: { cost_per_acre: 2.0 } },
      { cost: { cost_per_acre: null } },
      {}, // no cost at all
    ];
    expect(applicationCostPerAcre(lines)).toBeCloseTo(11.73, 2);
  });
  it("returns 0 when nothing priced", () => {
    expect(applicationCostPerAcre([{ cost: { cost_per_acre: null } }, {}])).toBe(0);
  });
});
