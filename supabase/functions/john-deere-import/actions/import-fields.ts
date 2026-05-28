import {
  callJohnDeereApi,
  callJohnDeereUrl,
  JOHN_DEERE_API_BASE,
} from "../../_shared/john-deere.ts";
import {
  convertBoundaryToGeoJSON,
  extractClients,
  extractFarms,
  JdLink,
  JdBoundary,
  JdField,
} from "../../_shared/boundaries.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// --- Field import helpers ---

async function fetchAllFieldsPaginated(accessToken: string, orgId: string): Promise<JdField[]> {
  const allFields: JdField[] = [];
  let url: string | null =
    `${JOHN_DEERE_API_BASE}/organizations/${orgId}/fields?embed=activeBoundary,clients,farms`;

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

    // Log all boundaries for debugging
    console.log(`[import] Field ${fieldId}: ${boundaries.length} total boundaries from API`);
    for (const b of boundaries) {
      console.log(
        `[import]   - name="${b.name || "(none)"}" active=${b.active} irrigated=${b.irrigated} area=${b.area?.valueAsDouble?.toFixed(1)} ${b.area?.unit || ""}`,
      );
    }

    // Filter for irrigated boundaries that are NOT the active field boundary
    // and NOT archived. ?recordFilter=all returns historical/archived
    // boundaries (old pivot shapes from prior years) that JD's UI hides;
    // including them double-counts irrigated acreage.
    const irrigated = boundaries.filter(
      (b) => b.irrigated === true && b.active !== true && b.archived !== true,
    );
    console.log(
      `[import] Field ${fieldId}: ${irrigated.length} irrigated (non-active, non-archived) boundaries found`,
    );
    return irrigated;
  } catch (_) {
    return [];
  }
}

export async function importFields(
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

    const boundary =
      field.activeBoundary ||
      (field.boundaries && field.boundaries.find((b: JdBoundary) => b.active)) ||
      (field.boundaries && field.boundaries[0]) ||
      null;

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
        } catch (_) {
          /* skip */
        }
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
        } catch (_) {
          /* skip */
        }
      }
    }

    const now = new Date().toISOString();
    await supabase.from("fields").upsert(
      {
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
      },
      { onConflict: "user_id,org_id,jd_field_id" },
    );
  }

  return { totalImported: allFields.length, withoutBoundaries };
}
