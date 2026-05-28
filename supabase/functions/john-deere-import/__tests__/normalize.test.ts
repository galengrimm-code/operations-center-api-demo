import { describe, it, expect } from "vitest";
import { normalizeProductName } from "../helpers/normalize.ts";

describe("normalizeProductName", () => {
  it("lowercases", () => {
    expect(normalizeProductName("ATRAZINE")).toBe("atrazine");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeProductName("  Atrazine  ")).toBe("atrazine");
  });

  it("collapses internal multiple-spaces to a single space", () => {
    expect(normalizeProductName("Anhydrous   Ammonia")).toBe("anhydrous ammonia");
  });

  it("preserves punctuation that is meaningful (e.g., '2,4-d', percents)", () => {
    expect(normalizeProductName("2,4-D")).toBe("2,4-d");
    expect(normalizeProductName("Zinc Sulfate 35%")).toBe("zinc sulfate 35%");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeProductName("")).toBe("");
    expect(normalizeProductName("   ")).toBe("");
  });

  it("strips trailing parenthetical brand/strength notes if present at end? NO — preserves them", () => {
    expect(normalizeProductName("Anhydrous Ammonia (NH3)")).toBe("anhydrous ammonia (nh3)");
  });
});
