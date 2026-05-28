import type { JdApplicationRateResult } from "../shared/types.ts";

const PLACEHOLDER = "---";

export function deriveApplicationName(
  input: JdApplicationRateResult,
): string | null {
  const outers = input.applicationProductTotals ?? [];
  const names = outers
    .map((o) => o.name?.trim() ?? "")
    .filter((n) => n.length > 0 && n !== PLACEHOLDER);

  if (names.length === 0) return null;

  const distinct = Array.from(new Set(names)).sort();
  return distinct.join("; ");
}
