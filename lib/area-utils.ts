const HA_TO_AC = 2.47105;
const AC_TO_HA = 1 / HA_TO_AC;
const SQM_TO_AC = 0.000247105;
const SQM_TO_HA = 0.0001;

export function sqMetersToAcres(sqm: number): number {
  return sqm * SQM_TO_AC;
}

export function sqMetersToUnit(sqm: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "ac") return sqm * SQM_TO_AC;
  if (u === "ha") return sqm * SQM_TO_HA;
  return sqm;
}

export function convertArea(value: number, fromUnit: string, toUnit: string): number {
  const from = fromUnit.toLowerCase();
  const to = toUnit.toLowerCase();

  if (from === to) return value;

  if (from === "ha" && to === "ac") return value * HA_TO_AC;
  if (from === "ac" && to === "ha") return value * AC_TO_HA;

  return value;
}

export function formatArea(
  value: number | null,
  sourceUnit: string | null,
  preferredUnit: string,
): string {
  if (value == null || !sourceUnit) return "";

  const converted = convertArea(value, sourceUnit, preferredUnit);
  const formatted = converted.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  return `${formatted} ${preferredUnit}`;
}
