// lib/unit-display.ts
// JD unitId -> human label. JD returns IDs like "gal1ac-1" (gallons per acre); we display "gal/ac".

const MAP: Record<string, string> = {
  ac: "ac",
  ha: "ha",
  gal: "gal",
  qt: "qt",
  pt: "pt",
  oz: "oz",
  lb: "lb",
  l: "L",
  ml: "mL",
  "gal1ac-1": "gal/ac",
  "qt1ac-1": "qt/ac",
  "pt1ac-1": "pt/ac",
  "oz1ac-1": "oz/ac",
  "lb1ac-1": "lb/ac",
  "ton1ac-1": "ton/ac",
  "l1ha-1": "L/ha",
  "ml1ha-1": "mL/ha",
  "kg1ha-1": "kg/ha",
  "mi1hr-1": "mph",
  "km1hr-1": "km/h",
};

export function displayUnit(unitId: string | null | undefined): string {
  if (!unitId) return "";
  return MAP[unitId] ?? unitId;
}

export function displayRate(
  value: number | null | undefined,
  unitId: string | null | undefined,
): string {
  if (value == null) return "—";
  return `${value} ${displayUnit(unitId)}`.trim();
}

export function displayTotal(
  value: number | null | undefined,
  unitId: string | null | undefined,
): string {
  if (value == null) return "—";
  return `${value} ${displayUnit(unitId)}`.trim();
}
