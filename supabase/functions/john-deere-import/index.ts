import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { logAndRespond } from "../_shared/generic-error.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import {
  callJohnDeereApi,
  callJohnDeereUrl,
  getValidToken,
  getUserConnection,
  JOHN_DEERE_API_BASE,
} from "../_shared/john-deere.ts";
import { JdLink, JdBoundary } from "../_shared/boundaries.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { importFields } from "./actions/import-fields.ts";

// --- Operations import helpers ---

interface JdOperation {
  id: string;
  fieldOperationType: string;
  cropSeason?: string;
  cropName?: string;
  startDate?: string;
  endDate?: string;
  varieties?: Array<{ name?: string }>;
  fieldOperationMachines?: Array<{ name?: string; vin?: string }>;
  links?: JdLink[];
}

// Map operation type to the primary measurement type name
const MEASUREMENT_TYPE_MAP: Record<string, string> = {
  harvest: "HarvestYieldResult",
  seeding: "SeedingRateResult",
  application: "ApplicationRateResult",
  tillage: "TillageDepthResult",
};

interface MeasurementResult {
  area_value?: number;
  area_unit?: string;
  avg_yield_value?: number;
  avg_yield_unit?: string;
  avg_moisture?: number;
  total_wet_mass_value?: number;
  total_wet_mass_unit?: string;
  measurement_type?: string;
}

async function fetchMeasurementData(
  accessToken: string,
  operationId: string,
  operationType: string,
): Promise<MeasurementResult> {
  const measurementType = MEASUREMENT_TYPE_MAP[operationType];
  if (!measurementType) return {};

  try {
    const response = await fetch(
      `${JOHN_DEERE_API_BASE}/fieldOperations/${operationId}/measurementTypes/${measurementType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.deere.axiom.v3+json",
          "Accept-UOM-System": "ENGLISH",
          "Accept-Yield-Preference": "VOLUME",
        },
      },
    );
    if (!response.ok) return {};

    const data = await response.json();
    return {
      area_value: data.area?.value,
      area_unit: data.area?.unitId,
      avg_yield_value: data.averageYield?.value,
      avg_yield_unit: data.averageYield?.unitId,
      avg_moisture: data.averageMoisture?.value,
      total_wet_mass_value: data.wetMass?.value,
      total_wet_mass_unit: data.wetMass?.unitId,
      measurement_type: measurementType,
    };
  } catch (_) {
    return {};
  }
}

interface MapImageResult {
  map_image_path?: string;
  map_image_extent?: unknown;
  map_image_legends?: unknown;
}

async function fetchAndStoreMapImage(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  operationId: string,
  operationType: string,
): Promise<MapImageResult> {
  const measurementType = MEASUREMENT_TYPE_MAP[operationType];
  if (!measurementType) return {};

  try {
    const response = await fetch(
      `${JOHN_DEERE_API_BASE}/fieldOperations/${operationId}/measurementTypes/${measurementType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.deere.axiom.v3.image+json",
          "Accept-UOM-System": "ENGLISH",
        },
      },
    );
    if (!response.ok) return {};

    const data = await response.json();
    const imageValue = data.value || data;
    const imageDataUri: string = imageValue.image || "";
    const extent = imageValue.extent || null;
    const legend = imageValue.legend || null;

    if (!imageDataUri) return {};

    // Strip data URI prefix and decode base64 to bytes
    const base64Data = imageDataUri.replace(/^data:image\/png;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to Supabase Storage
    const storagePath = `${userId}/${operationId}.png`;
    const { error: uploadError } = await supabase.storage
      .from("operation-images")
      .upload(storagePath, bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error(`[import] Failed to upload map image: ${uploadError.message}`);
      return {};
    }

    return {
      map_image_path: storagePath,
      map_image_extent: extent,
      map_image_legends: legend?.ranges || null,
    };
  } catch (err) {
    console.error(`[import] Map image fetch error:`, err);
    return {};
  }
}

async function importOperations(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  orgId: string,
) {
  // Get all fields for this org
  const { data: fields } = await supabase
    .from("fields")
    .select("jd_field_id, name")
    .eq("user_id", userId)
    .eq("org_id", orgId);

  if (!fields || fields.length === 0) {
    return { totalImported: 0 };
  }

  let totalImported = 0;
  const operationTypes = ["HARVEST", "SEEDING"];

  for (const field of fields) {
    for (const opType of operationTypes) {
      try {
        const response = await callJohnDeereApi(
          accessToken,
          `/organizations/${orgId}/fields/${field.jd_field_id}/fieldOperations?fieldOperationType=${opType}`,
        );

        if (!response.ok) continue;

        const data = await response.json();
        const operations: JdOperation[] = data.values || [];

        for (const op of operations) {
          const opTypeStr = op.fieldOperationType || opType.toLowerCase();

          // Fetch measurement data (area, yield, moisture) for all operation types
          const measurements = await fetchMeasurementData(accessToken, op.id, opTypeStr);

          // Fetch and store map image
          const imageData = await fetchAndStoreMapImage(
            supabase,
            accessToken,
            userId,
            op.id,
            opTypeStr,
          );

          const firstVariety = op.varieties?.[0];
          const firstMachine = op.fieldOperationMachines?.[0];

          const now = new Date().toISOString();
          await supabase.from("field_operations").upsert(
            {
              user_id: userId,
              org_id: orgId,
              jd_field_id: field.jd_field_id,
              jd_operation_id: op.id,
              operation_type: op.fieldOperationType || opType.toLowerCase(),
              crop_season: op.cropSeason || null,
              crop_name: op.cropName || null,
              start_date: op.startDate || null,
              end_date: op.endDate || null,
              variety_name: firstVariety?.name || null,
              machine_name: firstMachine?.name || null,
              machine_vin: firstMachine?.vin || null,
              ...measurements,
              ...imageData,
              raw_response: op,
              imported_at: now,
              updated_at: now,
            },
            { onConflict: "user_id,org_id,jd_operation_id" },
          );

          totalImported++;
        }
      } catch (_) {
        // Skip errors for individual fields/types
      }
    }
  }

  return { totalImported };
}

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    console.log("[import] Request method:", req.method);
    console.log("[import] Auth header present:", !!req.headers.get("Authorization"));

    const authResult = await getAuthenticatedUser(req);
    console.log(
      "[import] authResult type:",
      typeof authResult,
      "isResponse:",
      isResponse(authResult),
    );
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;
    console.log("[import] Authenticated user:", user.id);

    const connection = await getUserConnection(supabase, user.id);
    console.log("[import] Connection found:", !!connection, "org:", connection?.selected_org_id);
    if (!connection) {
      return errorResponse("No John Deere connection found", 404, undefined, req);
    }

    const orgId = connection.selected_org_id;
    if (!orgId) {
      return errorResponse("No organization selected", 400, undefined, req);
    }

    const accessToken = await getValidToken(supabase, connection);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "import-fields") {
      // Import fields, then automatically import operations
      const fieldResult = await importFields(supabase, accessToken, user.id, orgId);

      console.log(
        `[import] Imported ${fieldResult.totalImported} fields, now importing operations...`,
      );
      const opsResult = await importOperations(supabase, accessToken, user.id, orgId);
      console.log(`[import] Imported ${opsResult.totalImported} operations`);

      const { data: storedFields } = await supabase
        .from("fields")
        .select("*")
        .eq("user_id", user.id)
        .eq("org_id", orgId);

      return jsonResponse(
        {
          fields: storedFields || [],
          totalImported: fieldResult.totalImported,
          withoutBoundaries: fieldResult.withoutBoundaries,
          operationsImported: opsResult.totalImported,
        },
        200,
        req,
      );
    }

    if (action === "import-operations") {
      const opsResult = await importOperations(supabase, accessToken, user.id, orgId);

      return jsonResponse(
        {
          totalImported: opsResult.totalImported,
        },
        200,
        req,
      );
    }

    // Import operations for a single field (avoids timeout)
    if (action === "import-field-operations") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      let totalImported = 0;
      const operationTypes = ["HARVEST", "SEEDING"];

      for (const opType of operationTypes) {
        try {
          // Follow pagination to get ALL operations for this field
          let pageUrl: string | null =
            `${JOHN_DEERE_API_BASE}/organizations/${orgId}/fields/${fieldId}/fieldOperations?fieldOperationType=${opType}`;

          while (pageUrl) {
            const response = await callJohnDeereUrl(accessToken, pageUrl);
            if (!response.ok) break;

            const data = await response.json();
            const operations: JdOperation[] = data.values || [];

            for (const op of operations) {
              const opTypeStr = op.fieldOperationType || opType.toLowerCase();
              const measurements = await fetchMeasurementData(accessToken, op.id, opTypeStr);
              const imageData = await fetchAndStoreMapImage(
                supabase,
                accessToken,
                user.id,
                op.id,
                opTypeStr,
              );

              const firstVariety = op.varieties?.[0];
              const firstMachine = op.fieldOperationMachines?.[0];

              const now = new Date().toISOString();
              await supabase.from("field_operations").upsert(
                {
                  user_id: user.id,
                  org_id: orgId,
                  jd_field_id: fieldId,
                  jd_operation_id: op.id,
                  operation_type: opTypeStr,
                  crop_season: op.cropSeason || null,
                  crop_name: op.cropName || null,
                  start_date: op.startDate || null,
                  end_date: op.endDate || null,
                  variety_name: firstVariety?.name || null,
                  machine_name: firstMachine?.name || null,
                  machine_vin: firstMachine?.vin || null,
                  ...measurements,
                  ...imageData,
                  raw_response: op,
                  imported_at: now,
                  updated_at: now,
                },
                { onConflict: "user_id,org_id,jd_operation_id" },
              );

              totalImported++;
            }

            // Check for next page
            const nextLink = (data.links || []).find((l: JdLink) => l.rel === "nextPage");
            pageUrl = nextLink ? nextLink.uri : null;
          }
        } catch (err) {
          console.error(`[import] Error importing ${opType} for field ${fieldId}:`, err);
        }
      }

      return jsonResponse({ totalImported, fieldId }, 200, req);
    }

    // Diagnostic: show ALL boundaries (active + irrigated + others) for a field
    // so we can see what JD has for fields with bogus irrigated splits.
    if (action === "debug-field-boundaries") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      const response = await callJohnDeereApi(
        accessToken,
        `/organizations/${orgId}/fields/${fieldId}/boundaries?recordFilter=all`,
      );
      if (!response.ok) {
        return errorResponse(
          `John Deere API error: ${response.status}`,
          response.status,
          undefined,
          req,
        );
      }
      const data = await response.json();
      const boundaries: JdBoundary[] = data.values || [];

      const summary = boundaries.map((b) => {
        let polyCount = 0;
        let totalRings = 0;
        let totalPoints = 0;
        for (const p of b.multipolygons || []) {
          polyCount++;
          for (const r of p.rings || []) {
            totalRings++;
            totalPoints += (r.points || []).length;
          }
        }
        return {
          id: b.id,
          name: b.name || null,
          active: b.active,
          irrigated: b.irrigated ?? null,
          area_value: b.area?.valueAsDouble ?? null,
          area_unit: b.area?.unit ?? null,
          workable_value: b.workableArea?.valueAsDouble ?? null,
          polygon_count: polyCount,
          ring_count: totalRings,
          point_count: totalPoints,
        };
      });

      return jsonResponse({ fieldId, count: boundaries.length, boundaries: summary }, 200, req);
    }

    // Diagnostic: show what JD returns for a field's operations
    if (action === "debug-field-operations") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      const results: Record<string, unknown> = {};
      for (const opType of ["HARVEST", "SEEDING"]) {
        try {
          const response = await callJohnDeereApi(
            accessToken,
            `/organizations/${orgId}/fields/${fieldId}/fieldOperations?fieldOperationType=${opType}`,
          );
          if (response.ok) {
            const data = await response.json();
            results[opType] = {
              count: (data.values || []).length,
              operations: (data.values || []).map((op: JdOperation) => ({
                id: op.id,
                type: op.fieldOperationType,
                season: op.cropSeason,
                crop: op.cropName,
                startDate: op.startDate,
              })),
            };
          } else {
            results[opType] = { error: response.status, text: await response.text() };
          }
        } catch (err) {
          results[opType] = { error: (err as Error).message };
        }
      }

      return jsonResponse({ fieldId, results }, 200, req);
    }

    return errorResponse("Unknown action", 400, undefined, req);
  } catch (error) {
    return logAndRespond(500, "request_failed", "IMPORT_500", error, {}, req);
  }
});
