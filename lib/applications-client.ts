// lib/applications-client.ts
import { supabase } from "./supabase";
import { checkMutationResult } from "./check-mutation-result";
import type {
  ApplicationOperation,
  ApplicationWithLines,
  FieldOperationProductLine,
  Product,
} from "@/types/applications";

export interface ApplicationsListFilter {
  fieldId?: string;
  productId?: string;
  season?: string;
  category?: string;
}

export async function fetchApplications(
  filter: ApplicationsListFilter = {},
): Promise<ApplicationWithLines[]> {
  let q = (supabase.from("field_operations") as any)
    .select(
      `
      id, user_id, org_id, jd_field_id, jd_operation_id, operation_type,
      crop_season, start_date, end_date,
      application_name, application_name_jd_original, application_name_user_edited,
      measurement_status,
      product_lines:field_operation_products(
        id, user_id, org_id, field_operation_id, product_id, line_index,
        product_category_override, is_carrier,
        rate_value, rate_unit, rate_variable,
        total_value, total_unit, total_variable,
        area_value, area_unit,
        rate_value_jd_original, total_value_jd_original, area_value_jd_original,
        is_user_edited, edited_at, deleted_at, created_at, updated_at,
        product:products(*)
      ),
      field:fields(name)
    `,
    )
    .eq("operation_type", "application")
    .is("product_lines.deleted_at", null)
    .order("start_date", { ascending: false });

  if (filter.fieldId) q = q.eq("jd_field_id", filter.fieldId);
  if (filter.season) q = q.eq("crop_season", filter.season);

  const { data, error } = await q;
  if (error) throw error;

  // Reshape: lift field name + apply filters that span join boundaries client-side.
  return (data ?? [])
    .map((row: any) => ({
      ...row,
      field_name: row.field?.name ?? "Unknown",
      product_lines: row.product_lines ?? [],
    }))
    .filter((row: ApplicationWithLines) => {
      if (filter.productId && !row.product_lines.some((l) => l.product_id === filter.productId))
        return false;
      if (filter.category) {
        const has = row.product_lines.some((l) => {
          const effective = l.product_category_override ?? l.product?.product_category;
          return effective === filter.category;
        });
        if (!has) return false;
      }
      return true;
    });
}

export async function fetchProductsRollup(season?: string): Promise<
  Array<{
    product: Product;
    total_value_sum: number;
    total_unit: string | null;
    field_count: number;
    operation_count: number;
  }>
> {
  // Use a single query with aggregation; Supabase RPC would be cleaner but we keep it client-side for v1.
  const { data, error } = await (supabase.from("field_operation_products") as any)
    .select(
      `
      total_value, total_unit, product_id, field_operation_id,
      field_operation:field_operations!inner(crop_season, jd_field_id),
      product:products(*)
    `,
    )
    .is("deleted_at", null);
  if (error) throw error;

  const byProduct = new Map<
    string,
    {
      product: Product;
      total_value_sum: number;
      total_unit: string | null;
      fields: Set<string>;
      operations: Set<string>;
    }
  >();
  for (const row of (data ?? []) as any[]) {
    if (season && row.field_operation?.crop_season !== season) continue;
    const pid = row.product_id as string;
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        product: row.product,
        total_value_sum: 0,
        total_unit: row.total_unit,
        fields: new Set(),
        operations: new Set(),
      });
    }
    const acc = byProduct.get(pid)!;
    acc.total_value_sum += row.total_value ?? 0;
    if (row.field_operation?.jd_field_id) acc.fields.add(row.field_operation.jd_field_id);
    acc.operations.add(row.field_operation_id);
  }
  return Array.from(byProduct.values()).map((acc) => ({
    product: acc.product,
    total_value_sum: acc.total_value_sum,
    total_unit: acc.total_unit,
    field_count: acc.fields.size,
    operation_count: acc.operations.size,
  }));
}
