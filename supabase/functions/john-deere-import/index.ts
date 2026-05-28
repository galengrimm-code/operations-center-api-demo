import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { logAndRespond } from "../_shared/generic-error.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import { getValidToken, getUserConnection } from "../_shared/john-deere.ts";
import { importFields } from "./actions/import-fields.ts";
import { importOperations } from "./actions/import-operations.ts";
import { importFieldOperations } from "./actions/import-field-operations.ts";
import { debugFieldBoundaries } from "./actions/debug-field-boundaries.ts";
import { debugFieldOperations } from "./actions/debug-field-operations.ts";

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

    if (action === "import-field-operations") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      const result = await importFieldOperations(
        supabase,
        accessToken,
        user.id,
        orgId,
        fieldId,
      );
      return jsonResponse(result, 200, req);
    }

    if (action === "debug-field-boundaries") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      const result = await debugFieldBoundaries(accessToken, orgId, fieldId);
      if (!result.ok) {
        return errorResponse(
          `John Deere API error: ${result.status}`,
          result.status,
          undefined,
          req,
        );
      }
      return jsonResponse(
        { fieldId: result.fieldId, count: result.count, boundaries: result.boundaries },
        200,
        req,
      );
    }

    if (action === "debug-field-operations") {
      const fieldId = url.searchParams.get("fieldId");
      if (!fieldId) {
        return errorResponse("Missing fieldId parameter", 400, undefined, req);
      }

      const result = await debugFieldOperations(accessToken, orgId, fieldId);
      return jsonResponse(result, 200, req);
    }

    return errorResponse("Unknown action", 400, undefined, req);
  } catch (error) {
    return logAndRespond(500, "request_failed", "IMPORT_500", error, {}, req);
  }
});
