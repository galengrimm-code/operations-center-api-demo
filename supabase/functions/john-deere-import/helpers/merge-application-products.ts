// supabase/functions/john-deere-import/helpers/merge-application-products.ts

import type { ExtractedProductLine } from "../shared/types.ts";

export interface ExistingProductRow {
  id: string;
  line_index: number;
  product_id: string;
  is_user_edited: boolean;
  deleted_at: string | null;
}

export interface InsertRow {
  field_operation_id: string;
  user_id: string;
  org_id: string;
  line_index: number;
  product_id: string;
  is_carrier: boolean;
  rate_value: number | null;
  rate_unit: string | null;
  rate_variable: string | null;
  total_value: number | null;
  total_unit: string | null;
  total_variable: string | null;
  area_value: number | null;
  area_unit: string | null;
  rate_value_jd_original: number | null;
  total_value_jd_original: number | null;
  area_value_jd_original: number | null;
  is_user_edited: false;
  raw_response: unknown;
  deleted_at: null;
}

export interface UpdateRow {
  id: string;
  patch: {
    rate_value: number | null;
    rate_unit: string | null;
    rate_variable: string | null;
    total_value: number | null;
    total_unit: string | null;
    total_variable: string | null;
    area_value: number | null;
    area_unit: string | null;
    rate_value_jd_original: number | null;
    total_value_jd_original: number | null;
    area_value_jd_original: number | null;
    raw_response: unknown;
    deleted_at: null; // un-delete if was soft-deleted then JD brings the line back
  };
}

export interface SoftDeleteRow {
  id: string;
}

export interface SkipRecord {
  id: string;
  reason: "user_edited_present_in_jd" | "user_edited_vanished_from_jd";
}

export interface MergePlan {
  toInsert: InsertRow[];
  toUpdate: UpdateRow[];
  toSoftDelete: SoftDeleteRow[];
  skipped: SkipRecord[];
}

export interface MergeInput {
  incoming: ExtractedProductLine[];
  existing: ExistingProductRow[];
  productIdByJdId: Map<string, string>; // jd_product_id -> products.id (UUID)
  field_operation_id: string;
  user_id: string;
  org_id: string;
}

export function mergeApplicationProducts(input: MergeInput): MergePlan {
  const plan: MergePlan = {
    toInsert: [],
    toUpdate: [],
    toSoftDelete: [],
    skipped: [],
  };

  const existingByLineIndex = new Map(input.existing.map((e) => [e.line_index, e]));
  const incomingByLineIndex = new Map(input.incoming.map((i) => [i.line_index, i]));

  for (const inc of input.incoming) {
    const productId = input.productIdByJdId.get(inc.jd_product_id);
    if (!productId) {
      throw new Error(
        `mergeApplicationProducts: incoming line references unknown jd_product_id="${inc.jd_product_id}". Products catalog must be upserted before merge.`,
      );
    }

    const existing = existingByLineIndex.get(inc.line_index);

    if (!existing) {
      // Case 1: new line → INSERT
      plan.toInsert.push({
        field_operation_id: input.field_operation_id,
        user_id: input.user_id,
        org_id: input.org_id,
        line_index: inc.line_index,
        product_id: productId,
        is_carrier: inc.is_carrier,
        rate_value: inc.rate_value,
        rate_unit: inc.rate_unit,
        rate_variable: inc.rate_variable,
        total_value: inc.total_value,
        total_unit: inc.total_unit,
        total_variable: inc.total_variable,
        area_value: inc.area_value,
        area_unit: inc.area_unit,
        rate_value_jd_original: inc.rate_value,
        total_value_jd_original: inc.total_value,
        area_value_jd_original: inc.area_value,
        is_user_edited: false,
        raw_response: inc.raw_response,
        deleted_at: null,
      });
    } else if (existing.is_user_edited) {
      // Case 3: user-edited line present in JD → SKIP
      plan.skipped.push({ id: existing.id, reason: "user_edited_present_in_jd" });
    } else {
      // Case 2: non-edited line present in JD → UPDATE
      plan.toUpdate.push({
        id: existing.id,
        patch: {
          rate_value: inc.rate_value,
          rate_unit: inc.rate_unit,
          rate_variable: inc.rate_variable,
          total_value: inc.total_value,
          total_unit: inc.total_unit,
          total_variable: inc.total_variable,
          area_value: inc.area_value,
          area_unit: inc.area_unit,
          rate_value_jd_original: inc.rate_value,
          total_value_jd_original: inc.total_value,
          area_value_jd_original: inc.area_value,
          raw_response: inc.raw_response,
          deleted_at: null,
        },
      });
    }
  }

  for (const ex of input.existing) {
    if (incomingByLineIndex.has(ex.line_index)) continue; // handled above
    if (ex.is_user_edited) {
      // Case 5: vanished from JD but user-edited → leave untouched
      plan.skipped.push({ id: ex.id, reason: "user_edited_vanished_from_jd" });
    } else {
      // Case 4: vanished from JD, not edited → soft-delete
      plan.toSoftDelete.push({ id: ex.id });
    }
  }

  return plan;
}
