/**
 * Global crop filter. User can hide certain crop names (cover crops like
 * RYE, GRASSLAND, etc.) from all views by managing a list on their connection.
 *
 * Crops in GLOBALLY_EXCLUDED_CROPS are *always* hidden — not user-toggleable.
 * Treat these as off the platform entirely.
 */
// GRASSLAND + HARD_FESCUE_GRASS are excluded from the fdh schema (the migration dropped them),
// so they must be globally hidden here too or the app would show ops the fdh reads can't return.
export const GLOBALLY_EXCLUDED_CROPS = ["RYE", "GRASSLAND", "HARD_FESCUE_GRASS"] as const;

function mergedHidden(hidden: string[] | null | undefined): Set<string> {
  const set = new Set<string>(GLOBALLY_EXCLUDED_CROPS);
  (hidden || []).forEach((c) => set.add(c));
  return set;
}

export function isCropHidden(
  cropName: string | null | undefined,
  hidden: string[] | null | undefined,
): boolean {
  if (!cropName) return false;
  return mergedHidden(hidden).has(cropName);
}

export function filterHiddenOperations<T extends { crop_name: string | null }>(
  items: T[],
  hidden: string[] | null | undefined,
): T[] {
  const merged = mergedHidden(hidden);
  return items.filter((it) => !it.crop_name || !merged.has(it.crop_name));
}

/**
 * Common cover crops worth suggesting even if the user hasn't imported
 * operations for them yet. Used in the Settings UI to seed the checklist.
 */
export const COMMON_COVER_CROPS = [
  "RYE",
  "GRASSLAND",
  "RADISH",
  "TURNIP",
  "CLOVER",
  "ALFALFA",
] as const;
