import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { logAndRespond } from "../_shared/generic-error.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import { callJohnDeereApi, getValidToken, getUserConnection } from "../_shared/john-deere.ts";

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

    const accessToken = await getValidToken(supabase, connection);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "organizations") {
      const response = await callJohnDeereApi(accessToken, "/organizations");

      if (!response.ok) {
        const errorText = await response.text();
        return logAndRespond(
          response.status,
          "request_failed",
          "API_JD_ORGS",
          new Error(`JD organizations returned ${response.status}`),
          { errorText },
          req,
        );
      }

      return jsonResponse(await response.json(), 200, req);
    }

    if (action === "select-organization") {
      const { orgId, orgName } = await req.json();

      if (!orgId) {
        return errorResponse("Missing orgId", 400, undefined, req);
      }

      await supabase
        .from("john_deere_connections")
        .update({
          selected_org_id: orgId,
          selected_org_name: orgName || null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      return jsonResponse({ success: true }, 200, req);
    }

    if (action === "fields") {
      const orgId = connection.selected_org_id;
      if (!orgId) {
        return errorResponse("No organization selected", 400, undefined, req);
      }

      const response = await callJohnDeereApi(accessToken, `/organizations/${orgId}/fields`);
      if (!response.ok) {
        const errorText = await response.text();
        return logAndRespond(
          response.status,
          "request_failed",
          "API_JD_FIELDS",
          new Error(`JD fields returned ${response.status}`),
          { orgId, errorText },
          req,
        );
      }

      return jsonResponse(await response.json(), 200, req);
    }

    if (action === "get-stored-fields") {
      const orgId = connection.selected_org_id;
      if (!orgId) {
        return errorResponse("No organization selected", 400, undefined, req);
      }

      // Track 2 (fdh migration): when FDH_READ_FIELDS=true, read the fdh adapter
      // view instead of the legacy table. Same columns/shape (drop-in). Flip the
      // secret to revert — no redeploy needed.
      const fieldsSource =
        Deno.env.get("FDH_READ_FIELDS") === "true" ? "fdh_fields" : "fields";

      const { data: storedFields, error: fieldsError } = await supabase
        .from(fieldsSource)
        .select("*")
        .eq("user_id", user.id)
        .eq("org_id", orgId);

      if (fieldsError) {
        return logAndRespond(500, "request_failed", "API_DB_FIELDS", fieldsError, { orgId }, req);
      }

      return jsonResponse({ fields: storedFields || [] }, 200, req);
    }

    if (action === "get-stored-operations") {
      const orgId = connection.selected_org_id;
      if (!orgId) {
        return errorResponse("No organization selected", 400, undefined, req);
      }

      const fieldId = url.searchParams.get("fieldId");
      const operationType = url.searchParams.get("operationType");

      // Track 2 (fdh ops migration): read the fdh adapter view when FDH_READ_OPS=true.
      // Same columns/shape (drop-in). Flip the secret to revert — no redeploy needed.
      const opsSource =
        Deno.env.get("FDH_READ_OPS") === "true" ? "fdh_field_operations" : "field_operations";

      let query = supabase
        .from(opsSource)
        .select("*")
        .eq("user_id", user.id)
        .eq("org_id", orgId)
        .order("start_date", { ascending: false });

      if (fieldId) {
        query = query.eq("jd_field_id", fieldId);
      }
      if (operationType) {
        query = query.eq("operation_type", operationType);
      }

      const { data: operations, error: opsError } = await query;

      if (opsError) {
        return logAndRespond(500, "request_failed", "API_DB_OPS", opsError, { orgId }, req);
      }

      return jsonResponse({ operations: operations || [] }, 200, req);
    }

    return errorResponse("Unknown action", 400, undefined, req);
  } catch (error) {
    return logAndRespond(500, "request_failed", "API_500", error, {}, req);
  }
});
