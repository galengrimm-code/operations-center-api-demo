// lib/category-utils.ts

export type ProductCategory = "fertilizer" | "chemical" | "seed" | "adjuvant" | "other";

// Free-text field — these 5 are the v1 UI defaults; finer values are valid free text.
export const KNOWN_CATEGORIES: ProductCategory[] = [
  "fertilizer",
  "chemical",
  "seed",
  "adjuvant",
  "other",
];

export interface CategorySeed {
  name_pattern: string;
  match_type: "contains" | "exact";
  product_category: string;
}

export function matchCategoryFromSeeds(
  name_normalized: string,
  seeds: CategorySeed[],
): string | null {
  const haystack = name_normalized.trim().toLowerCase();
  if (haystack.length === 0) return null;

  // Exact matches take priority — scan exact first
  for (const seed of seeds) {
    if (seed.match_type === "exact" && haystack === seed.name_pattern.toLowerCase()) {
      return seed.product_category;
    }
  }
  for (const seed of seeds) {
    if (seed.match_type === "contains" && haystack.includes(seed.name_pattern.toLowerCase())) {
      return seed.product_category;
    }
  }
  return null;
}

export function effectiveCategory(args: {
  override: string | null | undefined;
  productCategory: string | null | undefined;
}): string | null {
  if (args.override) return args.override;
  return args.productCategory ?? null;
}
