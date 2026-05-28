import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { optionsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAuthenticatedUser, isResponse } from "../_shared/auth.ts";
import { exchangeCodeForTokens, refreshAccessToken } from "../_shared/john-deere.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    const authResult = await getAuthenticatedUser(req);
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "exchange") {
      const { code, redirectUri } = await req.json();

      if (!code || !redirectUri) {
        return errorResponse("Missing code or redirectUri", 400, undefined, req);
      }

      const tokens = await exchangeCodeForTokens(code, redirectUri);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      const { error: upsertError } = await supabase.from("john_deere_connections").upsert(
        {
          user_id: user.id,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (upsertError) {
        throw new Error(`Failed to save tokens: ${upsertError.message}`);
      }

      return jsonResponse({ success: true }, 200, req);
    }

    if (action === "refresh") {
      const { data: connection, error: connError } = await supabase
        .from("john_deere_connections")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (connError || !connection) {
        return errorResponse("No John Deere connection found", 404, undefined, req);
      }

      const tokens = await refreshAccessToken(connection.refresh_token);
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      await supabase
        .from("john_deere_connections")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      return jsonResponse({ success: true }, 200, req);
    }

    if (action === "disconnect") {
      await supabase.from("john_deere_connections").delete().eq("user_id", user.id);

      return jsonResponse({ success: true }, 200, req);
    }

    return errorResponse("Unknown action", 400, undefined, req);
  } catch (error) {
    console.error("Error:", error);
    return errorResponse(error.message, 500, undefined, req);
  }
});
