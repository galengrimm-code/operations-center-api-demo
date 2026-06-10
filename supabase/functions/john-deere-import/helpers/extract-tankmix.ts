// supabase/functions/john-deere-import/helpers/extract-tankmix.ts

import type { ExtractedProductLine, JdApplicationRateResult } from "../shared/types.ts";

export function extractTankmix(input: JdApplicationRateResult): ExtractedProductLine[] {
  const out: ExtractedProductLine[] = [];
  const outers = input.applicationProductTotals ?? [];
  let lineIndex = 0;

  for (let i = 0; i < outers.length; i++) {
    const outer = outers[i];
    const inners = outer.productTotals ?? [];
    for (const inner of inners) {
      out.push({
        line_index: lineIndex++,
        outer_aggregate_index: i,
        jd_product_id: inner.productId ?? "",
        name: inner.name ?? "",
        brand: inner.brand && inner.brand !== "---" ? inner.brand : null,
        is_carrier: inner.carrier === true,
        rate_value: inner.averageMaterial?.value ?? null,
        rate_unit: inner.averageMaterial?.unitId ?? null,
        rate_variable: inner.averageMaterial?.variableRepresentation ?? null,
        total_value: inner.totalMaterial?.value ?? null,
        total_unit: inner.totalMaterial?.unitId ?? null,
        total_variable: inner.totalMaterial?.variableRepresentation ?? null,
        area_value: outer.appliedArea?.value ?? outer.area?.value ?? null,
        area_unit: outer.appliedArea?.unitId ?? outer.area?.unitId ?? null,
        raw_response: inner,
      });
    }
  }

  return out;
}
