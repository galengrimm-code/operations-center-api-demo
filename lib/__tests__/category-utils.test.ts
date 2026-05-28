import { describe, it, expect } from "vitest";
import { matchCategoryFromSeeds, effectiveCategory } from "../category-utils";
import type { CategorySeed } from "../category-utils";

const seeds: CategorySeed[] = [
  { name_pattern: "atrazine",   match_type: "contains", product_category: "chemical" },
  { name_pattern: "outlook",    match_type: "exact",    product_category: "chemical" },
  { name_pattern: "uan",        match_type: "exact",    product_category: "fertilizer" },
  { name_pattern: "urea",       match_type: "contains", product_category: "fertilizer" },
  { name_pattern: "water",      match_type: "exact",    product_category: "other" },
];

describe("matchCategoryFromSeeds", () => {
  it("returns category for an exact match", () => {
    expect(matchCategoryFromSeeds("outlook", seeds)).toBe("chemical");
    expect(matchCategoryFromSeeds("uan", seeds)).toBe("fertilizer");
  });

  it("returns category for a contains match", () => {
    expect(matchCategoryFromSeeds("atrazine 4l", seeds)).toBe("chemical");
    expect(matchCategoryFromSeeds("urea 46-0-0", seeds)).toBe("fertilizer");
  });

  it("does NOT exact-match if name has extra chars", () => {
    expect(matchCategoryFromSeeds("outlook 6oz", seeds)).toBe(null);
    expect(matchCategoryFromSeeds("uan 32%", seeds)).toBe(null);
  });

  it("returns null when no seed matches", () => {
    expect(matchCategoryFromSeeds("mystery-product", seeds)).toBe(null);
  });

  it("prefers exact match over contains when both apply (deterministic order)", () => {
    // 'outlook' exact and (hypothetically) a 'out' contains both — exact wins
    const seedsConflict: CategorySeed[] = [
      { name_pattern: "out",    match_type: "contains", product_category: "fertilizer" },
      { name_pattern: "outlook", match_type: "exact",   product_category: "chemical" },
    ];
    expect(matchCategoryFromSeeds("outlook", seedsConflict)).toBe("chemical");
  });

  it("is case-insensitive on input (caller already normalizes, but defensive)", () => {
    expect(matchCategoryFromSeeds("ATRAZINE", seeds)).toBe("chemical");
  });

  it("returns null for empty input", () => {
    expect(matchCategoryFromSeeds("", seeds)).toBe(null);
  });
});

describe("effectiveCategory", () => {
  it("returns line-override when set", () => {
    expect(effectiveCategory({ override: "fertilizer", productCategory: "chemical" })).toBe("fertilizer");
  });

  it("falls back to product catalog category when no override", () => {
    expect(effectiveCategory({ override: null, productCategory: "chemical" })).toBe("chemical");
    expect(effectiveCategory({ override: undefined, productCategory: "chemical" })).toBe("chemical");
  });

  it("returns null when both are absent", () => {
    expect(effectiveCategory({ override: null, productCategory: null })).toBe(null);
  });
});
