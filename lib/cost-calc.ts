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
  const amountInPriceUnit = convertAmount(totalValue, totalUnit, price.price_unit, price.density_lbs_per_gal);
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
  const priced = lines.filter(
    (l) => l.totalCost != null && l.appliedAcres > 0,
  ) as Array<{ totalCost: number; appliedAcres: number }>;
  if (priced.length === 0) return null;
  if (basis === "actual") {
    return priced.reduce((sum, l) => sum + l.totalCost / l.appliedAcres, 0);
  }
  if (fieldAcres <= 0) return null;
  return priced.reduce((sum, l) => sum + l.totalCost, 0) / fieldAcres;
}

/**
 * Sum of cost_per_acre across all product lines for one application.
 * Null cost_per_acre values and lines without a cost object are skipped (treated as 0 in the sum).
 * Returns 0 when nothing is priced — callers guard with `anyPriced` before rendering.
 */
export function applicationCostPerAcre(
  lines: Array<{ cost?: { cost_per_acre: number | null } }>,
): number {
  return lines.reduce((s, l) => s + (l.cost?.cost_per_acre ?? 0), 0);
}

/** convenience: a known unit guard for UI (re-export). */
export { unitFamily };
