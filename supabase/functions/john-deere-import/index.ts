import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import {
  callJohnDeereApi,
  callJohnDeereUrl,
  getValidToken,
  getUserConnection,
  JOHN_DEERE_API_BASE,
} from "../_shared/john-deere.ts";
import {
  convertBoundaryToGeoJSON,
  extractClients,
  extractFarms,
  JdLink,
  JdBoundary,
  JdField,
} from "../_shared/boundaries.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// --- Field import helpers ---

async function fetchAllFieldsPaginated(accessToken: string, orgId: string): Promise<JdField[]> {
  const allFields: JdField[] = [];
  let url: string | null = `${JOHN_DEERE_API_BASE}/organizations/${orgId}/fields?embed=activeBoundary,clients,farms`;

  while (url) {
    const response = await callJohnDeereUrl(accessToken, url);
    if (!response.ok) {
      throw new Error(`John Deere API error: ${response.status}`);
    }
    const data = await response.json();
    allFields.push(...(data.values || []));

    const nextLink = (data.links || []).find((l: JdLink) => l.rel === "nextPage");
    url = nextLink ? nextLink.uri : null;
  }

  return allFields;
}

async function fetchIrrigatedBoundaries(
  accessToken: string,
  orgId: string,
  fieldId: string,
): Promise<JdBoundary[]> {
  try {
    const response = await callJohnDeereApi(
      accessToken,
      `/organizations/${orgId}/fields/${fieldId}/boundaries?recordFilter=all`,
    );
    if (!response.ok) return [];

    const data = await response.json();
    const boundaries: JdBoundary[] = data.values || [];
    return boundaries.filter((b) => b.irrigated === true);
  } catch (_) {
    return [];
  }
}

async function importFields(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  orgId: string,
) {
  const allFields = await fetchAllFieldsPaginated(accessToken, orgId);
  let withoutBoundaries = 0;

  for (const field of allFields) {
    let boundaryGeojson = null;
    let boundaryAreaValue = null;
    let boundaryAreaUnit = null;
    let activeBoundary = false;

    const boundary = field.activeBoundary
      || (field.boundaries && field.boundaries.find((b: JdBoundary) => b.active))
      || (field.boundaries && field.boundaries[0])
      || null;

    if (boundary) {
      boundaryGeojson = convertBoundaryToGeoJSON(boundary);
      if (boundary.area) {
        boundaryAreaValue = boundary.area.valueAsDouble;
        boundaryAreaUnit = boundary.area.unit;
      }
      activeBoundary = boundary.active !== false;
    }

    if (!boundaryGeojson) {
      withoutBoundaries++;
    }

    let irrigatedBoundaryGeojson = null;
    let irrigatedBoundaryAreaValue = null;
    let irrigatedBoundaryAreaUnit = null;
    let hasIrrigatedBoundary = false;

    const irrigatedBoundaries = await fetchIrrigatedBoundaries(accessToken, orgId, field.id);
    if (irrigatedBoundaries.length > 0) {
      // Merge all irrigated boundaries into a single MultiPolygon
      const allCoordinates: number[][][][] = [];
      let totalArea = 0;
      let areaUnit = "";

      for (const ib of irrigatedBoundaries) {
        const geojson = convertBoundaryToGeoJSON(ib);
        if (geojson) {
          allCoordinates.push(...geojson.coordinates);
        }
        if (ib.area) {
          totalArea += ib.area.valueAsDouble;
          areaUnit = ib.area.unit;
        }
      }

      if (allCoordinates.length > 0) {
        irrigatedBoundaryGeojson = { type: "MultiPolygon", coordinates: allCoordinates };
        irrigatedBoundaryAreaValue = totalArea;
        irrigatedBoundaryAreaUnit = areaUnit;
        hasIrrigatedBoundary = true;
      }
    }

    let clientName: string | null = null;
    let clientId: string | null = null;
    let farmName: string | null = null;
    let farmId: string | null = null;

    const embeddedClients = extractClients(field);
    if (embeddedClients.length > 0) {
      clientName = embeddedClients[0].name || null;
      clientId = embeddedClients[0].id || null;
    } else {
      const clientsLink = field.links?.find((l: JdLink) => l.rel === "clients");
      if (clientsLink) {
        try {
          const clientsResp = await callJohnDeereUrl(accessToken, clientsLink.uri);
          if (clientsResp.ok) {
            const clientsData = await clientsResp.json();
            const firstClient = (clientsData.values || [])[0];
            if (firstClient) {
              clientName = firstClient.name || null;
              clientId = firstClient.id || null;
            }
          }
        } catch (_) { /* skip */ }
      }
    }

    const embeddedFarms = extractFarms(field);
    if (embeddedFarms.length > 0) {
      farmName = embeddedFarms[0].name || null;
      farmId = embeddedFarms[0].id || null;
    } else {
      const farmsLink = field.links?.find((l: JdLink) => l.rel === "farms");
      if (farmsLink) {
        try {
          const farmsResp = await callJohnDeereUrl(accessToken, farmsLink.uri);
          if (farmsResp.ok) {
            const farmsData = await farmsResp.json();
            const firstFarm = (farmsData.values || [])[0];
            if (firstFarm) {
              farmName = firstFarm.name || null;
              farmId = firstFarm.id || null;
            }
          }
        } catch (_) { /* skip */ }
      }
    }

    const now = new Date().toISOString();
    await supabase
      .from("fields")
      .upsert({
        user_id: userId,
        org_id: orgId,
        jd_field_id: field.id,
        name: field.name || "Unnamed Field",
        boundary_geojson: boundaryGeojson,
        boundary_area_value: boundaryAreaValue,
        boundary_area_unit: boundaryAreaUnit,
        active_boundary: activeBoundary,
        irrigated_boundary_geojson: irrigatedBoundaryGeojson,
        irrigated_boundary_area_value: irrigatedBoundaryAreaValue,
        irrigated_boundary_area_unit: irrigatedBoundaryAreaUnit,
        has_irrigated_boundary: hasIrrigatedBoundary,
        client_name: clientName,
        client_id: clientId,
        farm_name: farmName,
        farm_id: farmId,
        raw_response: field,
        imported_at: now,
        updated_at: now,
      }, { onConflict: "user_id,org_id,jd_field_id" });
  }

  return { totalImported: allFields.length, withoutBoundaries };
}

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
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.deere.axiom.v3+json",
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
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.deere.axiom.v3.image+json",
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
          const imageData = await fetchAndStoreMapImage(supabase, accessToken, userId, op.id, opTypeStr);

          const firstVariety = op.varieties?.[0];
          const firstMachine = op.fieldOperationMachines?.[0];

          const now = new Date().toISOString();
          await supabase
            .from("field_operations")
            .upsert({
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
            }, { onConflict: "user_id,org_id,jd_operation_id" });

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
    return optionsResponse();
  }

  try {
    console.log("[import] Request method:", req.method);
    console.log("[import] Auth header present:", !!req.headers.get("Authorization"));
    console.log("[import] Auth header value (first 30):", req.headers.get("Authorization")?.substring(0, 30));

    const authResult = await getAuthenticatedUser(req);
    console.log("[import] authResult type:", typeof authResult, "isResponse:", isResponse(authResult));
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;
    console.log("[import] Authenticated user:", user.id);

    const connection = await getUserConnection(supabase, user.id);
    console.log("[import] Connection found:", !!connection, "org:", connection?.selected_org_id);
    if (!connection) {
      return errorResponse("No John Deere connection found", 404);
    }

    const orgId = connection.selected_org_id;
    if (!orgId) {
      return errorResponse("No organization selected", 400);
    }

    const accessToken = await getValidToken(supabase, connection);
    console.log("[import] Got valid token, length:", accessToken.length);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "import-fields") {
      // Import fields, then automatically import operations
      const fieldResult = await importFields(supabase, accessToken, user.id, orgId);

      console.log(`[import] Imported ${fieldResult.totalImported} fields, now importing operations...`);
      const opsResult = await importOperations(supabase, accessToken, user.id, orgId);
      console.log(`[import] Imported ${opsResult.totalImported} operations`);

      const { data: storedFields } = await supabase
        .from("fields")
        .select("*")
        .eq("user_id", user.id)
        .eq("org_id", orgId);

      return jsonResponse({
        fields: storedFields || [],
        totalImported: fieldResult.totalImported,
        withoutBoundaries: fieldResult.withoutBoundaries,
        operationsImported: opsResult.totalImported,
      });
    }

    if (action === "import-operations") {
      const opsResult = await importOperations(supabase, accessToken, user.id, orgId);

      return jsonResponse({
        totalImported: opsResult.totalImported,
      });
    }

    return errorResponse("Unknown action", 400);
  } catch (error) {
    console.error("[import] Error:", error);
    console.error("[import] Error stack:", error.stack);
    return errorResponse(error.message, 500, error.stack);
  }
});
