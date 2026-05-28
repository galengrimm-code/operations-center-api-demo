import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractTankmix } from "../helpers/extract-tankmix.ts";
import type { JdApplicationRateResult } from "../shared/types.ts";

function loadFixture(name: string): JdApplicationRateResult {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, `../../../../__fixtures__/jd/${name}`), "utf-8"),
  );
}

describe("extractTankmix", () => {
  it("returns two flat lines for the single-tankmix fixture (Atrazine-like + water)", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result).toHaveLength(2);
  });

  it("assigns global line_index across outer aggregates (0, 1) for single-aggregate input", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.map((l) => l.line_index)).toEqual([0, 1]);
  });

  it("captures the carrier flag from JD on each line", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.find((l) => l.name === "EnzUpP")?.is_carrier).toBe(false);
    expect(result.find((l) => l.name === "Water")?.is_carrier).toBe(true);
  });

  it("extracts rate_value + rate_unit from averageMaterial", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    const enz = result.find((l) => l.name === "EnzUpP");
    expect(enz?.rate_value).toBe(7.49);
    expect(enz?.rate_unit).toBe("gal1ac-1");
  });

  it("extracts total_value + total_unit from totalMaterial", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    const enz = result.find((l) => l.name === "EnzUpP");
    expect(enz?.total_value).toBe(0.3);
    expect(enz?.total_unit).toBe("gal");
  });

  it("inherits area_value + area_unit from the OUTER ApplicationProductTotal", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result[0].area_value).toBe(0.04);
    expect(result[0].area_unit).toBe("ac");
  });

  it("returns empty array when applicationProductTotals is missing or empty", () => {
    expect(extractTankmix({} as JdApplicationRateResult)).toEqual([]);
    expect(extractTankmix({ applicationProductTotals: [] })).toEqual([]);
  });

  it("preserves the raw JD ProductTotal verbatim on raw_response", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result[0].raw_response.productId).toBe("66834dae-f252-4454-99b0-d7a287e9d4fe");
  });

  it("preserves outer_aggregate_index so downstream can group by tank mix recipe", () => {
    const input = loadFixture("application-rate-result-single-tankmix.json");
    const result = extractTankmix(input);
    expect(result.every((l) => l.outer_aggregate_index === 0)).toBe(true);
  });
});
