import { callJohnDeereApi } from "../../_shared/john-deere.ts";
import { JdOperation } from "./import-operations.ts";

// --- Diagnostic: show what JD returns for a field's operations ---

export async function debugFieldOperations(
  accessToken: string,
  orgId: string,
  fieldId: string,
) {
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

  return { fieldId, results };
}
