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
