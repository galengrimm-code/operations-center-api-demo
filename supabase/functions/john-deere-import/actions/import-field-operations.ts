import { JOHN_DEERE_API_BASE } from "../../_shared/john-deere.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchMeasurementData } from "../helpers/fetch-measurement-data.ts";
import { fetchAndStoreMapImage } from "../helpers/fetch-map-image.ts";
import { paginate } from "../helpers/pagination.ts";
import { JdOperation } from "./import-operations.ts";

// --- Single-field operations import (avoids timeout) ---

export async function importFieldOperations(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  orgId: string,
  fieldId: string,
) {
  let totalImported = 0;
  const operationTypes = ["HARVEST", "SEEDING"];

  for (const opType of operationTypes) {
    try {
      const initialUrl =
        `${JOHN_DEERE_API_BASE}/organizations/${orgId}/fields/${fieldId}/fieldOperations?fieldOperationType=${opType}`;

      for await (const op of paginate<JdOperation>(accessToken, initialUrl)) {
        const opTypeStr = op.fieldOperationType || opType.toLowerCase();
        const measurements = await fetchMeasurementData(accessToken, op.id, opTypeStr);
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
    } catch (err) {
      console.error(`[import] Error importing ${opType} for field ${fieldId}:`, err);
    }
  }

  return { totalImported, fieldId };
}
