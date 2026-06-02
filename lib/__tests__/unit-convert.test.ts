// lib/__tests__/unit-convert.test.ts
import { describe, it, expect } from "vitest";
import { convertAmount, unitFamily } from "../unit-convert";

describe("unitFamily", () => {
  it("classifies weight and volume", () => {
    expect(unitFamily("lb")).toBe("weight");
    expect(unitFamily("ton")).toBe("weight");
    expect(unitFamily("ozm")).toBe("weight");
    expect(unitFamily("gal")).toBe("volume");
    expect(unitFamily("floz")).toBe("volume");
    expect(unitFamily("qt")).toBe("volume");
    expect(unitFamily("pt")).toBe("volume");
    expect(unitFamily("bogus")).toBeNull();
  });
});

describe("convertAmount — same unit", () => {
  it("returns the value unchanged", () => {
    expect(convertAmount(5, "lb", "lb")).toBe(5);
  });
});

describe("convertAmount — within weight", () => {
  it("lb -> ozm", () => expect(convertAmount(1, "lb", "ozm")).toBeCloseTo(16, 6));
  it("ton -> lb", () => expect(convertAmount(1, "ton", "lb")).toBeCloseTo(2000, 6));
  it("lb -> ton", () => expect(convertAmount(2000, "lb", "ton")).toBeCloseTo(1, 6));
});

describe("convertAmount — within volume", () => {
  it("gal -> floz", () => expect(convertAmount(1, "gal", "floz")).toBeCloseTo(128, 6));
  it("floz -> gal", () => expect(convertAmount(128, "floz", "gal")).toBeCloseTo(1, 6));
  it("gal -> qt", () => expect(convertAmount(1, "gal", "qt")).toBeCloseTo(4, 6));
  it("gal -> pt", () => expect(convertAmount(1, "gal", "pt")).toBeCloseTo(8, 6));
});

describe("convertAmount — cross family via density", () => {
  it("gal -> lb uses density (lbs/gal)", () =>
    expect(convertAmount(1, "gal", "lb", 11.05)).toBeCloseTo(11.05, 6));
  it("lb -> gal is the inverse", () =>
    expect(convertAmount(11.05, "lb", "gal", 11.05)).toBeCloseTo(1, 6));
  it("floz -> ton via density", () =>
    expect(convertAmount(128, "floz", "ton", 2000)).toBeCloseTo(1, 6)); // 128 floz=1 gal; 1 gal*2000 lb/gal=2000 lb=1 ton
  it("returns null when density missing", () =>
    expect(convertAmount(1, "gal", "lb")).toBeNull());
  it("returns null when density is zero/negative", () => {
    expect(convertAmount(1, "gal", "lb", 0)).toBeNull();
    expect(convertAmount(1, "gal", "lb", -2)).toBeNull();
  });
});

describe("convertAmount — unknown units", () => {
  it("returns null", () => {
    expect(convertAmount(1, "bogus", "lb")).toBeNull();
    expect(convertAmount(1, "lb", "bogus")).toBeNull();
  });
});
