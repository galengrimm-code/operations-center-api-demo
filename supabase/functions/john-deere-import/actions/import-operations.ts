import { callJohnDeereApi } from "../../_shared/john-deere.ts";
import { JdLink } from "../../_shared/boundaries.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchMeasurementData } from "../helpers/fetch-measurement-data.ts";
import { fetchAndStoreMapImage } from "../helpers/fetch-map-image.ts";

// --- Operations import helpers ---

export interface JdOperation {
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

export async function importOperations(
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
