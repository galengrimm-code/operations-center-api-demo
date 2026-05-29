import { describe, it, expect } from "vitest";
import { displayUnit, displayRate, displayTotal } from "../unit-display";

describe("displayUnit", () => {
  it("maps known JD unitIds to human labels", () => {
    expect(displayUnit("gal")).toBe("gal");
    expect(displayUnit("ac")).toBe("ac");
    expect(displayUnit("gal1ac-1")).toBe("gal/ac");
    expect(displayUnit("qt1ac-1")).toBe("qt/ac");
    expect(displayUnit("lb1ac-1")).toBe("lb/ac");
    expect(displayUnit("mi1hr-1")).toBe("mph");
    expect(displayUnit("l1ha-1")).toBe("L/ha");
    expect(displayUnit("ha")).toBe("ha");
  });

  it("returns the raw unitId when unknown (don't silently lie)", () => {
    expect(displayUnit("xyz")).toBe("xyz");
  });

  it("returns empty for null/undefined", () => {
    expect(displayUnit(null)).toBe("");
    expect(displayUnit(undefined)).toBe("");
  });
});

describe("displayRate", () => {
  it("formats value + unit", () => {
    expect(displayRate(4, "qt1ac-1")).toBe("4 qt/ac");
    expect(displayRate(7.49, "gal1ac-1")).toBe("7.49 gal/ac");
  });
  it("returns dash for null value", () => {
    expect(displayRate(null, "gal1ac-1")).toBe("—");
  });
});

describe("displayTotal", () => {
  it("formats value + unit", () => {
    expect(displayTotal(316, "qt")).toBe("316 qt");
  });
  it("returns dash for null", () => {
    expect(displayTotal(null, "qt")).toBe("—");
  });
});
