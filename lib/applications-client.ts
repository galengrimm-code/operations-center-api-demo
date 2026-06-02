// lib/applications-client.ts
import { supabase } from "./supabase";
import { checkMutationResult } from "./check-mutation-result";
import type {
  ApplicationOperation,
  ApplicationWithLines,
  FieldOperationProductLine,
  Product,
  ProductLineEdit,
  ProductPrice,
} from "@/types/applications";

export interface ApplicationsListFilter {
  fieldId?: string;
  productId?: string;
  season?: string;
  category?: string;
  farm?: string;
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
  // name + farm via a separate query. Fields uniqueness is (user_id, org_id, jd_field_id),
  // so jd_field_id alone is not a safe key across orgs — key on org_id + jd_field_id.
  const { data: fieldRows, error: fieldErr } = await (supabase.from("fields") as any).select(
    "org_id, jd_field_id, name, farm_name",
  );
  if (fieldErr) throw fieldErr;
  const fieldByKey = new Map<string, { name: string; farm_name: string | null }>(
    (fieldRows ?? []).map((f: any) => [
      `${f.org_id}:${f.jd_field_id}`,
      { name: f.name, farm_name: f.farm_name ?? null },
    ]),
  );

  // Reshape: lift field name + farm, then apply filters that span join boundaries client-side.
  return (data ?? [])
    .map((row: any) => {
      const field = fieldByKey.get(`${row.org_id}:${row.jd_field_id}`);
      return {
        ...row,
        field_name: field?.name ?? "Unknown",
        farm_name: field?.farm_name ?? null,
        product_lines: row.product_lines ?? [],
      };
    })
    .filter((row: ApplicationWithLines) => {
      if (filter.farm && row.farm_name !== filter.farm) return false;
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

export async function fetchProductsRollup(
  season?: string,
  farm?: string,
): Promise<
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
      field_operation:field_operations!inner(crop_season, jd_field_id, org_id),
      product:products(*)
    `,
    )
    .is("deleted_at", null);
  if (error) throw error;

  // Resolve farm per field (no FK embed available) so the global farm filter applies here too.
  let farmByKey: Map<string, string | null> | null = null;
  if (farm) {
    const { data: fieldRows, error: fieldErr } = await (supabase.from("fields") as any).select(
      "org_id, jd_field_id, farm_name",
    );
    if (fieldErr) throw fieldErr;
    farmByKey = new Map<string, string | null>(
      (fieldRows ?? []).map((f: any) => [`${f.org_id}:${f.jd_field_id}`, f.farm_name ?? null]),
    );
  }

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
    if (farmByKey) {
      const key = `${row.field_operation?.org_id}:${row.field_operation?.jd_field_id}`;
      if (farmByKey.get(key) !== farm) continue;
    }
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

export async function fetchProductPrices(year: number, orgId: string): Promise<ProductPrice[]> {
  const { data, error } = await (supabase.from("product_prices") as any)
    .select("*").eq("year", year).eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as ProductPrice[];
}

// Years that actually have application data (drives the year selector — no hardcoded list).
export async function fetchSeasonYears(orgId: string): Promise<number[]> {
  const { data, error } = await (supabase.from("field_operations") as any)
    .select("crop_season").eq("org_id", orgId).eq("operation_type", "application");
  if (error) throw error;
  const years = new Set<number>();
  for (const r of (data ?? []) as any[]) {
    if (/^\d{4}$/.test(String(r.crop_season ?? ""))) years.add(Number(r.crop_season));
  }
  return Array.from(years).sort((a, b) => b - a); // newest first
}

// average price_per_unit per product across all years (for "All seasons", read-only).
// Only averages rows that share the product's modal price_unit to avoid mixing units.
export async function fetchProductPriceAverages(orgId: string): Promise<Map<string, { avg: number; unit: string }>> {
  const { data, error } = await (supabase.from("product_prices") as any)
    .select("product_id, price_per_unit, price_unit").eq("org_id", orgId);
  if (error) throw error;
  const byProduct = new Map<string, { sums: Map<string, { total: number; n: number }> }>();
  for (const r of (data ?? []) as any[]) {
    const e = byProduct.get(r.product_id) ?? { sums: new Map() };
    const s = e.sums.get(r.price_unit) ?? { total: 0, n: 0 };
    s.total += Number(r.price_per_unit); s.n += 1;
    e.sums.set(r.price_unit, s); byProduct.set(r.product_id, e);
  }
  const out = new Map<string, { avg: number; unit: string }>();
  for (const [pid, e] of Array.from(byProduct)) {
    // pick the unit with the most rows; average within it
    let best: { unit: string; total: number; n: number } | null = null;
    for (const [unit, s] of Array.from(e.sums)) if (!best || s.n > best.n) best = { unit, ...s };
    if (best) out.set(pid, { avg: best.total / best.n, unit: best.unit });
  }
  return out;
}

export async function upsertProductPrice(input: {
  productId: string; orgId: string; year: number; pricePerUnit: number; priceUnit: string;
}): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("not authenticated");
  const { error } = await (supabase.from("product_prices") as any).upsert(
    {
      user_id: userId, org_id: input.orgId, product_id: input.productId,
      year: input.year, price_per_unit: input.pricePerUnit, price_unit: input.priceUnit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,org_id,product_id,year" },
  );
  if (error) throw error;
}

export async function setProductDensity(productId: string, density: number | null): Promise<void> {
  const { error } = await (supabase.from("products") as any)
    .update({ density_lbs_per_gal: density, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) throw error;
}

// Bulk-copy a year's prices into another year (HP "Inputs Copy"). Does not overwrite existing.
export async function copyPricesFromYear(fromYear: number, toYear: number, orgId: string): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("not authenticated");
  // org-scoped on BOTH sides — never copy another org's price onto this org's product.
  const src = await fetchProductPrices(fromYear, orgId);
  const existing = new Set((await fetchProductPrices(toYear, orgId)).map((p) => p.product_id));
  const rows = src.filter((p) => !existing.has(p.product_id)).map((p) => ({
    user_id: userId, org_id: orgId, product_id: p.product_id, year: toYear,
    price_per_unit: p.price_per_unit, price_unit: p.price_unit,
  }));
  if (rows.length === 0) return 0;
  const { error } = await (supabase.from("product_prices") as any).insert(rows);
  if (error) throw error;
  return rows.length;
}
