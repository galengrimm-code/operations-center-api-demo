import { callJohnDeereApi } from "../../_shared/john-deere.ts";
import { JdOperation } from "./import-operations.ts";

// --- Diagnostic: show what JD returns for a field's operations ---

export async function debugFieldOperations(accessToken: string, orgId: string, fieldId: string) {
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
        // Do NOT return the raw upstream body to the client (error-response
        // leakage). Log it server-side; surface only the status code.
        console.error(
          `[debug-field-operations] JD ${opType} non-OK ${response.status}:`,
          await response.text(),
        );
        results[opType] = { error: response.status };
      }
    } catch (err) {
      // Log the real error server-side; return a generic marker to the client.
      console.error(`[debug-field-operations] ${opType} failed:`, err);
      results[opType] = { error: "request_failed" };
    }
  }

  return { fieldId, results };
}
