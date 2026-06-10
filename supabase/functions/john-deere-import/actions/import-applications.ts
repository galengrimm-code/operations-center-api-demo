// supabase/functions/john-deere-import/actions/import-applications.ts
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../../_shared/cors.ts";
import { JOHN_DEERE_API_BASE } from "../../_shared/john-deere.ts";
import { paginate } from "../helpers/pagination.ts";
import { extractTankmix } from "../helpers/extract-tankmix.ts";
import { deriveApplicationName } from "../helpers/derive-application-name.ts";
import { normalizeProductName } from "../helpers/normalize.ts";
import {
  mergeApplicationProducts,
  type ExistingProductRow,
} from "../helpers/merge-application-products.ts";
import type { ExtractedProductLine, JdApplicationRateResult } from "../shared/types.ts";
import { ImportApplicationsQuery, parseSeasons } from "../shared/validation.ts";
import { logAndRespond } from "../../_shared/generic-error.ts";

interface Ctx {
  supabase: SupabaseClient;
  accessToken: string;
  user: User;
  orgId: string;
  url: URL;
  req?: Request; // optional, used for CORS in error responses
}

interface JdOperationLite {
  id: string;
  fieldOperationType?: string;
  cropSeason?: string;
  startDate?: string;
  endDate?: string;
}

interface CategorySeedRow {
  name_pattern: string;
  match_type: "contains" | "exact";
  product_category: string;
}

const APPLICATION = "APPLICATION";
const APPLICATION_RATE_RESULT = "ApplicationRateResult";

export async function importApplications(ctx: Ctx): Promise<Response> {
  // Parse query
  const queryObj = Object.fromEntries(ctx.url.searchParams.entries());
  const parse = ImportApplicationsQuery.safeParse(queryObj);
  if (!parse.success) {
    return logAndRespond(
      400,
      "validation_failed",
      "IMPORT_APP_400_VALIDATION",
      parse.error,
      {},
      ctx.req,
    );
  }
  const seasons = new Set(parseSeasons(parse.data.seasons));

  // Read seeds once (small table, ~21 rows)
  const { data: seeds, error: seedsErr } = await ctx.supabase
    .from("product_category_seeds")
    .select("name_pattern, match_type, product_category");
  if (seedsErr) {
    return logAndRespond(500, "request_failed", "IMPORT_APP_500_SEEDS", seedsErr, {}, ctx.req);
  }
  const seedList: CategorySeedRow[] = seeds ?? [];

  // Read fields to scan
  const fieldsQuery = ctx.supabase
    .from("fields")
    .select("jd_field_id, name")
    .eq("user_id", ctx.user.id)
    .eq("org_id", ctx.orgId);
  if (parse.data.fieldId) fieldsQuery.eq("jd_field_id", parse.data.fieldId);
  const { data: fields, error: fieldsErr } = await fieldsQuery;
  if (fieldsErr) {
    return logAndRespond(500, "request_failed", "IMPORT_APP_500_FIELDS", fieldsErr, {}, ctx.req);
  }
  if (!fields || fields.length === 0) {
    return jsonResponse({ totalImported: 0, message: "No stored fields to scan." }, 200, ctx.req);
  }

  let totalOps = 0;
  let totalLines = 0;
  let totalNotFound = 0;
  let totalErrors = 0;

  for (const field of fields) {
    const opsUrl = `${JOHN_DEERE_API_BASE}/organizations/${ctx.orgId}/fields/${field.jd_field_id}/fieldOperations?fieldOperationType=${APPLICATION}`;
    for await (const op of paginate<JdOperationLite>(ctx.accessToken, opsUrl)) {
      if (op.cropSeason && !seasons.has(op.cropSeason)) continue;

      // Fetch the measurement (with imperial)
      const measResp = await fetch(
        `${JOHN_DEERE_API_BASE}/fieldOperations/${op.id}/measurementTypes/${APPLICATION_RATE_RESULT}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            Accept: "application/vnd.deere.axiom.v3+json",
            "Accept-UOM-System": "ENGLISH",
          },
        },
      );

      let measurementStatus: "available" | "not_found" | "error" = "available";
      let measurement: JdApplicationRateResult = {};
      if (measResp.status === 404) {
        measurementStatus = "not_found";
        totalNotFound++;
      } else if (!measResp.ok) {
        measurementStatus = "error";
        totalErrors++;
      } else {
        measurement = (await measResp.json()) as JdApplicationRateResult;
      }

      // Upsert field_operations row
      const applicationName =
        measurementStatus === "available" ? deriveApplicationName(measurement) : null;

      const { data: foRow, error: foErr } = await ctx.supabase
        .from("field_operations")
        .select("id, application_name_user_edited")
        .eq("user_id", ctx.user.id)
        .eq("org_id", ctx.orgId)
        .eq("jd_operation_id", op.id)
        .maybeSingle();
      if (foErr) {
        return logAndRespond(
          500,
          "request_failed",
          "IMPORT_APP_500_FO_READ",
          foErr,
          { opId: op.id },
          ctx.req,
        );
      }

      const baseRow = {
        user_id: ctx.user.id,
        org_id: ctx.orgId,
        jd_field_id: field.jd_field_id,
        jd_operation_id: op.id,
        operation_type: "application",
        crop_season: op.cropSeason ?? null,
        start_date: op.startDate ?? null,
        end_date: op.endDate ?? null,
        measurement_status: measurementStatus,
        raw_response: measurement,
        updated_at: new Date().toISOString(),
      };

      let fieldOperationId: string;
      if (!foRow) {
        const { data: ins, error: insErr } = await ctx.supabase
          .from("field_operations")
          .insert({
            ...baseRow,
            application_name: applicationName,
            application_name_jd_original: applicationName,
            application_name_user_edited: false,
            imported_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insErr || !ins) {
          return logAndRespond(
            500,
            "request_failed",
            "IMPORT_APP_500_FO_INSERT",
            insErr,
            { opId: op.id },
            ctx.req,
          );
        }
        fieldOperationId = ins.id;
      } else {
        fieldOperationId = foRow.id;
        const patch: Record<string, unknown> = { ...baseRow };
        if (!foRow.application_name_user_edited) {
          patch.application_name = applicationName;
          patch.application_name_jd_original = applicationName;
        } else {
          patch.application_name_jd_original = applicationName; // refresh original even when user-edited
        }
        const { error: updErr } = await ctx.supabase
          .from("field_operations")
          .update(patch)
          .eq("id", fieldOperationId);
        if (updErr) {
          return logAndRespond(
            500,
            "request_failed",
            "IMPORT_APP_500_FO_UPDATE",
            updErr,
            { opId: op.id },
            ctx.req,
          );
        }
      }

      totalOps++;

      if (measurementStatus !== "available") continue;

      // Extract product lines and merge
      const incoming = extractTankmix(measurement);

      // Upsert products catalog for every product seen
      const productIdByJdId = new Map<string, string>();
      for (const line of incoming) {
        const productId = await upsertProduct(ctx, line, seedList);
        productIdByJdId.set(line.jd_product_id, productId);
      }

      // Read existing product rows for this op
      const { data: existing, error: exErr } = await ctx.supabase
        .from("field_operation_products")
        .select("id, line_index, product_id, is_user_edited, deleted_at")
        .eq("field_operation_id", fieldOperationId);
      if (exErr) {
        return logAndRespond(
          500,
          "request_failed",
          "IMPORT_APP_500_FOP_READ",
          exErr,
          { opId: op.id },
          ctx.req,
        );
      }
      const existingRows: ExistingProductRow[] = (existing ?? []).map((r) => ({
        id: r.id,
        line_index: r.line_index,
        product_id: r.product_id,
        is_user_edited: r.is_user_edited,
        deleted_at: r.deleted_at,
      }));

      const plan = mergeApplicationProducts({
        incoming,
        existing: existingRows,
        productIdByJdId,
        field_operation_id: fieldOperationId,
        user_id: ctx.user.id,
        org_id: ctx.orgId,
      });

      // Execute plan
      if (plan.toInsert.length > 0) {
        const { error: insErr } = await ctx.supabase
          .from("field_operation_products")
          .insert(plan.toInsert);
        if (insErr) {
          return logAndRespond(
            500,
            "request_failed",
            "IMPORT_APP_500_FOP_INSERT",
            insErr,
            { opId: op.id },
            ctx.req,
          );
        }
      }
      for (const upd of plan.toUpdate) {
        const { error: updErr } = await ctx.supabase
          .from("field_operation_products")
          .update(upd.patch)
          .eq("id", upd.id);
        if (updErr) {
          return logAndRespond(
            500,
            "request_failed",
            "IMPORT_APP_500_FOP_UPDATE",
            updErr,
            { rowId: upd.id },
            ctx.req,
          );
        }
      }
      for (const del of plan.toSoftDelete) {
        const { error: delErr } = await ctx.supabase
          .from("field_operation_products")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", del.id);
        if (delErr) {
          return logAndRespond(
            500,
            "request_failed",
            "IMPORT_APP_500_FOP_SOFTDELETE",
            delErr,
            { rowId: del.id },
            ctx.req,
          );
        }
      }

      totalLines += plan.toInsert.length + plan.toUpdate.length;
    }
  }

  return jsonResponse(
    {
      operations_processed: totalOps,
      product_lines_written: totalLines,
      measurements_not_found: totalNotFound,
      measurements_error: totalErrors,
    },
    200,
    ctx.req,
  );
}

// Helper: upsert a single product into the catalog.
async function upsertProduct(
  ctx: Ctx,
  line: ExtractedProductLine,
  seedList: CategorySeedRow[],
): Promise<string> {
  const nameNormalized = normalizeProductName(line.name);
  const matchedCategory = matchSeedCategory(nameNormalized, seedList);

  const { data: existing, error: readErr } = await ctx.supabase
    .from("products")
    .select("id, product_category, product_category_source")
    .eq("user_id", ctx.user.id)
    .eq("org_id", ctx.orgId)
    .eq("jd_product_id", line.jd_product_id)
    .maybeSingle();
  if (readErr) throw readErr;

  if (existing) {
    const shouldRefreshCategory = matchedCategory && existing.product_category_source !== "user";
    const patch: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_response: line.raw_response,
    };
    if (shouldRefreshCategory) {
      patch.product_category = matchedCategory;
      patch.product_category_source = "seed";
    }
    const { error: updErr } = await ctx.supabase
      .from("products")
      .update(patch)
      .eq("id", existing.id);
    if (updErr) throw updErr;
    return existing.id;
  }

  const { data: ins, error: insErr } = await ctx.supabase
    .from("products")
    .insert({
      user_id: ctx.user.id,
      org_id: ctx.orgId,
      jd_product_id: line.jd_product_id,
      name: line.name,
      name_normalized: nameNormalized,
      brand: line.brand,
      is_carrier_default: line.is_carrier,
      product_kind: "constituent",
      product_category: matchedCategory,
      product_category_source: matchedCategory ? "seed" : null,
      default_unit: line.total_unit,
      raw_response: line.raw_response,
    })
    .select("id")
    .single();
  if (insErr || !ins) throw insErr ?? new Error("insert returned no row");
  return ins.id;
}

function matchSeedCategory(nameNormalized: string, seeds: CategorySeedRow[]): string | null {
  const h = nameNormalized.trim().toLowerCase();
  if (h.length === 0) return null;
  for (const s of seeds) {
    if (s.match_type === "exact" && h === s.name_pattern.toLowerCase()) return s.product_category;
  }
  for (const s of seeds) {
    if (s.match_type === "contains" && h.includes(s.name_pattern.toLowerCase())) {
      return s.product_category;
    }
  }
  return null;
}
