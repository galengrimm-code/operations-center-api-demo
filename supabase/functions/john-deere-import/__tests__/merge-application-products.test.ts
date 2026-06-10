import { describe, it, expect } from "vitest";
import { mergeApplicationProducts } from "../helpers/merge-application-products.ts";
import type { ExtractedProductLine } from "../shared/types.ts";

const FIELD_OP_ID = "00000000-0000-0000-0000-00000000F0F0";
const USER_ID = "00000000-0000-0000-0000-00000000U0U0";
const ORG_ID = "600550";

function mkIncoming(overrides: Partial<ExtractedProductLine>): ExtractedProductLine {
  return {
    line_index: 0,
    outer_aggregate_index: 0,
    jd_product_id: "pid-A",
    name: "Atrazine",
    brand: null,
    is_carrier: false,
    rate_value: 4,
    rate_unit: "qt1ac-1",
    rate_variable: "vrAppRateVolumeMeasured",
    total_value: 316,
    total_unit: "qt",
    total_variable: "vrTotalQuantityAppliedVolume",
    area_value: 79,
    area_unit: "ac",
    raw_response: {} as ExtractedProductLine["raw_response"],
    ...overrides,
  };
}

function mkExisting(overrides: {
  id: string;
  line_index: number;
  product_id: string;
  is_user_edited?: boolean;
}) {
  return {
    id: overrides.id,
    line_index: overrides.line_index,
    product_id: overrides.product_id,
    is_user_edited: overrides.is_user_edited ?? false,
    deleted_at: null as string | null,
  };
}

describe("mergeApplicationProducts — 5-case decision tree", () => {
  it("Case 1: new line in JD, no DB row → INSERT", () => {
    const incoming = [mkIncoming({ line_index: 0 })];
    const existing: ReturnType<typeof mkExisting>[] = [];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.toInsert[0]).toMatchObject({
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
      line_index: 0,
      product_id: "00000000-0000-0000-0000-0000000000A0",
      is_user_edited: false,
      rate_value: 4,
      rate_value_jd_original: 4,
      total_value: 316,
      total_value_jd_original: 316,
      area_value: 79,
      area_value_jd_original: 79,
      deleted_at: null,
    });
  });

  it("Case 2: existing line, NOT user-edited, present in JD → UPDATE both live + JD-original", () => {
    const incoming = [mkIncoming({ line_index: 0, rate_value: 5 })]; // JD changed rate from 4 to 5
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: false,
      }),
    ];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.toUpdate[0]).toMatchObject({
      id: "row-X",
      patch: {
        rate_value: 5,
        rate_value_jd_original: 5,
        total_value: 316,
        total_value_jd_original: 316,
        area_value: 79,
        area_value_jd_original: 79,
      },
    });
  });

  it("Case 3: existing line, user-edited, present in JD → SKIP (preserve edits)", () => {
    const incoming = [mkIncoming({ line_index: 0, rate_value: 5 })];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: true,
      }),
    ];
    const productIdByJdId = new Map([["pid-A", "00000000-0000-0000-0000-0000000000A0"]]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toEqual({ id: "row-X", reason: "user_edited_present_in_jd" });
  });

  it("Case 4: existing line, NOT user-edited, line VANISHED from JD → SOFT-DELETE", () => {
    const incoming: ExtractedProductLine[] = [];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: false,
      }),
    ];
    const productIdByJdId = new Map();

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toEqual([{ id: "row-X" }]);
    expect(plan.skipped).toHaveLength(0);
  });

  it("Case 5: existing line, user-edited, line VANISHED from JD → LEAVE UNTOUCHED", () => {
    const incoming: ExtractedProductLine[] = [];
    const existing = [
      mkExisting({
        id: "row-X",
        line_index: 0,
        product_id: "00000000-0000-0000-0000-0000000000A0",
        is_user_edited: true,
      }),
    ];
    const productIdByJdId = new Map();

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.skipped).toEqual([{ id: "row-X", reason: "user_edited_vanished_from_jd" }]);
  });

  it("Combined: insert + update + skip + soft-delete in one merge", () => {
    const incoming = [
      mkIncoming({ line_index: 0, jd_product_id: "pid-A" }), // matches existing edited → skip
      mkIncoming({ line_index: 1, jd_product_id: "pid-B", name: "2,4-D" }), // matches existing non-edited → update
      mkIncoming({ line_index: 2, jd_product_id: "pid-C", name: "AMS" }), // new → insert
    ];
    const existing = [
      mkExisting({ id: "row-edit", line_index: 0, product_id: "pa", is_user_edited: true }),
      mkExisting({ id: "row-up", line_index: 1, product_id: "pb", is_user_edited: false }),
      mkExisting({ id: "row-del", line_index: 5, product_id: "pz", is_user_edited: false }), // vanished
    ];
    const productIdByJdId = new Map([
      ["pid-A", "pa"],
      ["pid-B", "pb"],
      ["pid-C", "pc"],
    ]);

    const plan = mergeApplicationProducts({
      incoming,
      existing,
      productIdByJdId,
      field_operation_id: FIELD_OP_ID,
      user_id: USER_ID,
      org_id: ORG_ID,
    });

    expect(plan.toInsert.map((r) => r.line_index)).toEqual([2]);
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["row-up"]);
    expect(plan.toSoftDelete.map((d) => d.id)).toEqual(["row-del"]);
    expect(plan.skipped.map((s) => s.id)).toEqual(["row-edit"]);
  });

  it("throws if incoming line references a productId not in productIdByJdId map", () => {
    const incoming = [mkIncoming({ jd_product_id: "pid-UNKNOWN" })];
    expect(() =>
      mergeApplicationProducts({
        incoming,
        existing: [],
        productIdByJdId: new Map(),
        field_operation_id: FIELD_OP_ID,
        user_id: USER_ID,
        org_id: ORG_ID,
      }),
    ).toThrow(/pid-UNKNOWN/);
  });
});
