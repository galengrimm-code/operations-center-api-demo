import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { logAndRespond } from "../_shared/generic-error.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import { getValidToken, getUserConnection } from "../_shared/john-deere.ts";
import { importFields } from "./actions/import-fields.ts";
import { importOperations } from "./actions/import-operations.ts";
import { importFieldOperations } from "./actions/import-field-operations.ts";
import { importApplications } from "./actions/import-applications.ts";
import { beginImportRun, finishImportRun, isValidRunId } from "./import-run.ts";

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    const authResult = await getAuthenticatedUser(req);
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;

    const connection = await getUserConnection(supabase, user.id);
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

    switch (action) {
      case "import-fields": {
        // This composite import (fields + operations + applications, hundreds of
        // JD API calls) regularly runs past the ~150s edge gateway timeout, so the
        // browser sees a 504 while the function finishes server-side. We record the
        // run's outcome in import_runs under the client-minted runId; the client
        // polls that exact row instead of holding the connection open. A client
        // that omits runId (older bundle, can't poll) still works — we mint one
        // server-side and it gets the legacy direct response.
        const runIdParam = url.searchParams.get("runId");
        if (runIdParam !== null && !isValidRunId(runIdParam)) {
          return errorResponse("Invalid runId", 400, undefined, req);
        }
        const runId = runIdParam ?? crypto.randomUUID();
        await beginImportRun(supabase, runId, user.id, orgId, "import-fields");
        try {
          // Import fields, then automatically import operations + applications
          const fieldResult = await importFields(supabase, accessToken, user.id, orgId);
          const opsResult = await importOperations(supabase, accessToken, user.id, orgId);
          // importApplications returns a Response; we invoke it for side effects only
          // (it writes to the applications table) and surface a simple flag in the composite.
          await importApplications({
            supabase,
            accessToken,
            user,
            orgId,
            url,
            req,
          });

          const { data: storedFields } = await supabase
            .from("fields")
            .select("*")
            .eq("user_id", user.id)
            .eq("org_id", orgId);

          const summary = {
            totalImported: fieldResult.totalImported,
            withoutBoundaries: fieldResult.withoutBoundaries,
            operationsImported: opsResult.totalImported,
            applicationsImported: true,
          };
          await finishImportRun(supabase, runId, "done", summary);
          return jsonResponse({ fields: storedFields || [], ...summary }, 200, req);
        } catch (err) {
          await finishImportRun(supabase, runId, "error", undefined, "IMPORT_FIELDS_FAILED");
          throw err;
        }
      }

      case "import-operations": {
        const runIdParam = url.searchParams.get("runId");
        if (runIdParam !== null && !isValidRunId(runIdParam)) {
          return errorResponse("Invalid runId", 400, undefined, req);
        }
        const runId = runIdParam ?? crypto.randomUUID();
        await beginImportRun(supabase, runId, user.id, orgId, "import-operations");
        try {
          const opsResult = await importOperations(supabase, accessToken, user.id, orgId);
          const summary = { totalImported: opsResult.totalImported };
          await finishImportRun(supabase, runId, "done", summary);
          return jsonResponse(summary, 200, req);
        } catch (err) {
          await finishImportRun(supabase, runId, "error", undefined, "IMPORT_OPERATIONS_FAILED");
          throw err;
        }
      }

      case "import-field-operations": {
        const fieldId = url.searchParams.get("fieldId");
        if (!fieldId) return errorResponse("Missing fieldId parameter", 400, undefined, req);
        const result = await importFieldOperations(supabase, accessToken, user.id, orgId, fieldId);
        return jsonResponse(result, 200, req);
      }

      case "import-applications": {
        return await importApplications({
          supabase,
          accessToken,
          user,
          orgId,
          url,
          req,
        });
      }

      default:
        return errorResponse("Unknown action", 400, undefined, req);
    }
  } catch (error) {
    return logAndRespond(500, "request_failed", "IMPORT_500", error, {}, req);
  }
});
