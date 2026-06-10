import { describe, it, expect } from "vitest";
import { deriveApplicationName } from "../helpers/derive-application-name.ts";
import type { JdApplicationRateResult } from "../shared/types.ts";

describe("deriveApplicationName", () => {
  it("returns the single outer name when there is exactly one", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("returns sorted distinct names joined with '; ' for multiple aggregates", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [
        { name: "Outlook" },
        { name: "Atrazine" },
        { name: "Outlook" }, // dup
      ],
    };
    expect(deriveApplicationName(input)).toBe("Atrazine; Outlook");
  });

  it("filters '---' placeholder names", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }, { name: "---" }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("filters empty string and whitespace-only names", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "Infurrow" }, { name: "" }, { name: "   " }],
    };
    expect(deriveApplicationName(input)).toBe("Infurrow");
  });

  it("returns null when no usable names exist", () => {
    expect(deriveApplicationName({})).toBeNull();
    expect(deriveApplicationName({ applicationProductTotals: [] })).toBeNull();
    expect(
      deriveApplicationName({
        applicationProductTotals: [{ name: "---" }, { name: "" }],
      }),
    ).toBeNull();
  });

  it("does NOT truncate at the storage layer (callers truncate for display)", () => {
    const longName = "A".repeat(200);
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: longName }],
    };
    expect(deriveApplicationName(input)).toBe(longName);
  });

  it("treats names case-sensitively for sort but preserves original casing", () => {
    const input: JdApplicationRateResult = {
      applicationProductTotals: [{ name: "outlook" }, { name: "Atrazine" }],
    };
    // ASCII sort: uppercase 'A' (65) < lowercase 'o' (111)
    expect(deriveApplicationName(input)).toBe("Atrazine; outlook");
  });
});
