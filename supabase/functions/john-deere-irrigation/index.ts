import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import {
  getValidToken,
  getUserConnection,
  JOHN_DEERE_API_BASE,
} from "../_shared/john-deere.ts";
import {
  buildExteriorOnlyGeoJSON,
  JdBoundary,
} from "../_shared/boundaries.ts";
import area from "npm:@turf/area@7";
import intersect from "npm:@turf/intersect@7";

const SQM_TO_AC = 0.000247105;

// --- Boundary-based irrigation analysis ---

interface BoundaryAnalysisResult {
  fieldId: string;
  fieldName: string;
  boundaryId: string;
  irrigated: boolean;
  totalArea: { value: number; unit: string };
  workableArea: { value: number; unit: string };
  irrigatedAcres: number;
  drylandAcres: number;
  exteriorGeoJSON: unknown;
  irrigatedBoundaryGeoJSON: unknown;
}

async function analyzeBoundary(
  supabase: ReturnType<typeof import("npm:@supabase/supabase-js@2").createClient>,
  userId: string,
  fieldId: string,
  fieldName: string,
): Promise<BoundaryAnalysisResult> {
  const { data: storedField, error: fieldError } = await supabase
    .from("fields")
    .select("raw_response, irrigated_boundary_geojson, has_irrigated_boundary")
    .eq("user_id", userId)
    .eq("jd_field_id", fieldId)
    .maybeSingle();

  if (fieldError || !storedField) {
    throw new Error("Field not found in database");
  }

  const rawBoundaries: JdBoundary[] = storedField.raw_response?.boundaries || [];
  const boundary = rawBoundaries.find((b: JdBoundary) => b.active) || rawBoundaries[0];

  if (!boundary) {
    throw new Error("No boundaries found for this field. Try re-importing fields.");
  }

  const totalAreaValue = boundary.area?.valueAsDouble ?? 0;
  const totalAreaUnit = boundary.area?.unit ?? "ha";
  const workableAreaValue = boundary.workableArea?.valueAsDouble ?? totalAreaValue;
  const workableAreaUnit = boundary.workableArea?.unit ?? totalAreaUnit;

  const exteriorGeoJSON = buildExteriorOnlyGeoJSON(boundary);
  const irrigatedBoundaryGeoJSON = storedField.irrigated_boundary_geojson || null;

  let irrigatedAcres = 0;
  let drylandAcres = 0;

  if (exteriorGeoJSON) {
    const totalSqm = area({ type: "Feature", geometry: exteriorGeoJSON, properties: {} });
    const totalAc = totalSqm * SQM_TO_AC;

    if (storedField.has_irrigated_boundary && irrigatedBoundaryGeoJSON) {
      // Intersect the entire irrigated MultiPolygon with the field boundary
      // in a single call — handles overlapping pivots without double-counting
      let irrigatedSqm = 0;
      try {
        const fieldFeature = { type: "Feature" as const, geometry: exteriorGeoJSON, properties: {} };
        const irrigFeature = { type: "Feature" as const, geometry: irrigatedBoundaryGeoJSON, properties: {} };
        const fc = { type: "FeatureCollection" as const, features: [fieldFeature, irrigFeature] };
        const intersectFn = intersect.intersect || intersect.default || intersect;
        const clipped = intersectFn(fc);
        if (clipped) {
          irrigatedSqm = area({ type: "Feature", geometry: clipped.geometry, properties: {} });
        }
      } catch (err) {
        console.error("[irrigation] Intersection failed:", err);
        irrigatedSqm = Math.min(
          area({ type: "Feature", geometry: irrigatedBoundaryGeoJSON, properties: {} }),
          totalSqm,
        );
      }
      irrigatedAcres = irrigatedSqm * SQM_TO_AC;
      drylandAcres = totalAc - irrigatedAcres;
    } else if (boundary.irrigated === true) {
      irrigatedAcres = totalAc;
      drylandAcres = 0;
    } else {
      irrigatedAcres = 0;
      drylandAcres = totalAc;
    }
  }

  const isIrrigated = storedField.has_irrigated_boundary || boundary.irrigated === true;

  return {
    fieldId,
    fieldName,
    boundaryId: boundary.id,
    irrigated: isIrrigated,
    totalArea: { value: totalAreaValue, unit: totalAreaUnit },
    workableArea: { value: workableAreaValue, unit: workableAreaUnit },
    irrigatedAcres,
    drylandAcres,
    exteriorGeoJSON,
    irrigatedBoundaryGeoJSON,
  };
}

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  try {
    const authResult = await getAuthenticatedUser(req);
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;

    const connection = await getUserConnection(supabase, user.id);
    if (!connection) {
      return errorResponse("No John Deere connection found", 404);
    }

    const orgId = connection.selected_org_id;
    if (!orgId) {
      return errorResponse("No organization selected", 400);
    }

    const accessToken = await getValidToken(supabase, connection);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "irrigation-analysis") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400);
      }

      const { data: storedField } = await supabase
        .from("fields")
        .select("name")
        .eq("user_id", user.id)
        .eq("jd_field_id", fieldId)
        .maybeSingle();

      const fieldName = storedField?.name || "Unknown Field";
      const result = await analyzeBoundary(supabase, user.id, fieldId, fieldName);
      return jsonResponse(result);
    }

    // Polls JD for shapefile status. When ready, downloads zip and uploads
    // to Supabase Storage so the client can fetch it without CORS issues.
    if (action === "shapefile-status") {
      const operationId = url.searchParams.get("operationId");
      if (!operationId) {
        return errorResponse("Missing operationId parameter", 400);
      }

      // Check if we already have this shapefile in storage
      const storagePath = `${user.id}/${operationId}.zip`;
      const { data: existing } = await supabase.storage
        .from("shapefiles")
        .list(user.id, { search: `${operationId}.zip` });

      if (existing && existing.length > 0) {
        return jsonResponse({ status: "ready", storagePath });
      }

      const shapefileUrl = `${JOHN_DEERE_API_BASE}/fieldOps/${operationId}?shapeType=Polygon&resolution=EachSensor`;
      console.log(`[irrigation] Requesting shapefile from: ${shapefileUrl}`);
      console.log(`[irrigation] Token (first 30): ${accessToken.substring(0, 30)}...`);

      const response = await fetch(shapefileUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.deere.axiom.v3+json",
        },
        redirect: "manual",
      });

      console.log(`[irrigation] JD response status: ${response.status}`);
      console.log(`[irrigation] JD response headers:`, Object.fromEntries(response.headers.entries()));

      if (response.status === 307) {
        const downloadUrl = response.headers.get("Location");
        if (!downloadUrl) {
          return errorResponse("Redirect with no Location header", 500);
        }

        // Download zip from JD's pre-signed URL
        console.log(`[irrigation] Downloading shapefile from JD redirect...`);
        const zipResponse = await fetch(downloadUrl);
        if (!zipResponse.ok) {
          return errorResponse(`Failed to download shapefile: ${zipResponse.status}`, 502);
        }

        const zipBytes = new Uint8Array(await zipResponse.arrayBuffer());
        console.log(`[irrigation] Downloaded ${(zipBytes.length / 1024).toFixed(0)} KB, uploading to storage...`);

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("shapefiles")
          .upload(storagePath, zipBytes, {
            contentType: "application/zip",
            upsert: true,
          });

        if (uploadError) {
          console.error("[irrigation] Storage upload error:", uploadError);
          return errorResponse(`Failed to upload shapefile to storage: ${uploadError.message}`, 500);
        }

        console.log(`[irrigation] Shapefile uploaded to storage`);
        return jsonResponse({ status: "ready", storagePath });
      }

      if (response.status === 202) {
        return jsonResponse({ status: "processing" }, 202);
      }

      if (response.status === 406) {
        return errorResponse("Shapefile cannot be generated for this operation", 406);
      }

      // Capture the full error response for debugging
      const responseBody = await response.text();
      console.error(`[irrigation] JD error response: status=${response.status}, body=${responseBody}`);
      return jsonResponse({
        error: `John Deere API error: ${response.status}`,
        details: responseBody,
        url: shapefileUrl,
        operationId,
      }, response.status);
    }

    return errorResponse("Unknown action", 400);
  } catch (error) {
    console.error("[irrigation] Error:", error);
    return errorResponse(error.message, 500);
  }
});
