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
import { importFields } from "./actions/import-fields.ts";
import { importOperations, JdOperation } from "./actions/import-operations.ts";
import { fetchMeasurementData } from "./helpers/fetch-measurement-data.ts";
import { fetchAndStoreMapImage } from "./helpers/fetch-map-image.ts";

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
