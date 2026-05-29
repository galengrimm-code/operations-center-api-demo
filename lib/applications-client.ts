// lib/applications-client.ts
import { supabase } from "./supabase";
import { checkMutationResult } from "./check-mutation-result";
import type {
  ApplicationOperation,
  ApplicationWithLines,
  FieldOperationProductLine,
  Product,
  ProductLineEdit,
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
      )
    `,
    )
    .eq("operation_type", "application")
    .is("product_lines.deleted_at", null)
    .order("start_date", { ascending: false });

  if (filter.fieldId) q = q.eq("jd_field_id", filter.fieldId);
  if (filter.season) q = q.eq("crop_season", filter.season);

  const { data, error } = await q;
  if (error) throw error;

  // No FK from field_operations -> fields for a PostgREST embed; resolve field
  // names via a separate query and map jd_field_id -> name.
  const { data: fieldRows } = await (supabase.from("fields") as any).select("jd_field_id, name");
  const fieldNameById = new Map<string, string>(
    (fieldRows ?? []).map((f: any) => [f.jd_field_id, f.name]),
  );

  // Reshape: lift field name + apply filters that span join boundaries client-side.
  return (data ?? [])
    .map((row: any) => ({
      ...row,
      field_name: fieldNameById.get(row.jd_field_id) ?? "Unknown",
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

export async function editProductLine(
  lineId: string,
  edits: ProductLineEdit,
): Promise<FieldOperationProductLine> {
  // Caller is responsible for Zod-validating numeric inputs.
  const { data, error } = await (supabase.from("field_operation_products") as any)
    .update({
      ...edits,
      is_user_edited: true,
      edited_at: new Date().toISOString(),
    })
    .eq("id", lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit product line", 1) as FieldOperationProductLine;
}

export async function revertProductLine(lineId: string): Promise<FieldOperationProductLine> {
  const { data: row, error: readErr } = await (supabase.from("field_operation_products") as any)
    .select("rate_value_jd_original, total_value_jd_original, area_value_jd_original")
    .eq("id", lineId)
    .single();
  if (readErr) throw readErr;

  const { data, error } = await (supabase.from("field_operation_products") as any)
    .update({
      rate_value: row.rate_value_jd_original,
      total_value: row.total_value_jd_original,
      area_value: row.area_value_jd_original,
      product_category_override: null,
      is_user_edited: false,
      edited_at: null,
    })
    .eq("id", lineId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "revert product line", 1) as FieldOperationProductLine;
}

export async function editProductCategory(productId: string, category: string): Promise<Product> {
  const { data, error } = await (supabase.from("products") as any)
    .update({
      product_category: category,
      product_category_source: "user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit product category", 1) as Product;
}

export async function editApplicationName(
  operationId: string,
  name: string,
): Promise<ApplicationOperation> {
  const { data, error } = await (supabase.from("field_operations") as any)
    .update({
      application_name: name,
      application_name_user_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "edit application name", 1) as ApplicationOperation;
}

export async function revertApplicationName(operationId: string): Promise<ApplicationOperation> {
  const { data: row, error: readErr } = await (supabase.from("field_operations") as any)
    .select("application_name_jd_original")
    .eq("id", operationId)
    .single();
  if (readErr) throw readErr;

  const { data, error } = await (supabase.from("field_operations") as any)
    .update({
      application_name: row.application_name_jd_original,
      application_name_user_edited: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .select()
    .single();
  if (error) throw error;
  return checkMutationResult(data, "revert application name", 1) as ApplicationOperation;
}
