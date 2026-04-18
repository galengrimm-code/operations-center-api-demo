/**
 * Global crop filter. User can hide certain crop names (cover crops like
 * RYE, GRASSLAND, etc.) from all views by managing a list on their connection.
 */

export function isCropHidden(
  cropName: string | null | undefined,
  hidden: string[] | null | undefined,
): boolean {
  if (!cropName || !hidden || hidden.length === 0) return false;
  return hidden.includes(cropName);
}

export function filterHiddenOperations<T extends { crop_name: string | null }>(
  items: T[],
  hidden: string[] | null | undefined,
): T[] {
  if (!hidden || hidden.length === 0) return items;
  return items.filter((it) => !isCropHidden(it.crop_name, hidden));
}

/**
 * Common cover crops worth suggesting even if the user hasn't imported
 * operations for them yet. Used in the Settings UI to seed the checklist.
 */
export const COMMON_COVER_CROPS = [
  'RYE',
  'GRASSLAND',
  'RADISH',
  'TURNIP',
  'CLOVER',
  'ALFALFA',
] as const;
