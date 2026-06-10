// TEMPORARY DIAGNOSTIC FUNCTION — Phase 0c of the spray-application sync build (2026-05-28).
//
// Purpose: dump the RAW John Deere ApplicationRateResult measurement response for
// real APPLICATION field operations on Galen's account, so the schema for products +
// field_operation_products can be designed against actual data shapes rather than just
// the auto-generated deere-sdk TS types.
//
// This function is READ-ONLY (no DB writes, no JD writes). It will be deleted once
// the schema is locked.
//
// Helpers are inlined (rather than imported from ../_shared/) because the MCP
// deploy path doesn't bundle sibling _shared directories.
//
// Deploy: verify_jwt: false (handles JWT internally via getAuthenticatedUser)
// Call:   GET /functions/v1/debug-spray-shape
//         Headers: Authorization: Bearer <user_jwt>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient, User } from "npm:@supabase/supabase-js@2";

// --- Inlined: cors helpers ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

function optionsResponse(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}

// --- Inlined: auth helpers (operations_center schema) ---
function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: "operations_center" },
  });
}

interface AuthResult {
  user: User;
  supabase: SupabaseClient;
}

async function getAuthenticatedUser(req: Request): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("No authorization header", 401);

  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) return errorResponse("Invalid user token", 401);
  return { user, supabase };
}

function isResponse(result: AuthResult | Response): result is Response {
  return result instanceof Response;
}

// --- Inlined: John Deere helpers ---
const JOHN_DEERE_API_BASE = "https://api.deere.com/platform";
const JOHN_DEERE_TOKEN_URL = "https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token";
const JOHN_DEERE_CLIENT_ID = Deno.env.get("JOHN_DEERE_CLIENT_ID") || "";
const JOHN_DEERE_CLIENT_SECRET = Deno.env.get("JOHN_DEERE_CLIENT_SECRET") || "";

interface Connection {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  selected_org_id: string | null;
  selected_org_name: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: JOHN_DEERE_CLIENT_ID,
    client_secret: JOHN_DEERE_CLIENT_SECRET,
  });
  const response = await fetch(JOHN_DEERE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
  return response.json();
}

async function getValidToken(supabase: SupabaseClient, connection: Connection): Promise<string> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() > bufferMs) return connection.access_token;

  const tokens = await refreshAccessToken(connection.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await supabase
    .from("john_deere_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return tokens.access_token;
}

async function callJohnDeereApi(accessToken: string, endpoint: string): Promise<Response> {
  return fetch(`${JOHN_DEERE_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.deere.axiom.v3+json",
    },
  });
}

async function getUserConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("john_deere_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Connection;
}

// --- The diagnostic ---
interface JdOperation {
  id: string;
  fieldOperationType?: string;
  cropSeason?: string;
  cropName?: string;
  startDate?: string;
  endDate?: string;
}

interface FieldRow {
  jd_field_id: string;
  name: string;
}

interface SampleResult {
  field: { id: string; name: string };
  application_operations_found: number;
  sampled_operations: Array<{
    operation_meta: {
      id: string;
      type: string | undefined;
      season: string | undefined;
      crop: string | undefined;
      startDate: string | undefined;
      endDate: string | undefined;
    };
    measurement_response_raw: unknown;
  }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();

  try {
    const authResult = await getAuthenticatedUser(req);
    if (isResponse(authResult)) return authResult;
    const { user, supabase } = authResult;

    const connection = await getUserConnection(supabase, user.id);
    if (!connection) return errorResponse("No John Deere connection found", 404);

    const orgId = connection.selected_org_id;
    if (!orgId) return errorResponse("No organization selected", 400);

    const accessToken = await getValidToken(supabase, connection);

    const { data: fields, error: fieldsErr } = await supabase
      .from("fields")
      .select("jd_field_id, name")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .limit(20);

    if (fieldsErr) return errorResponse("Failed to read stored fields", 500);
    if (!fields || fields.length === 0) {
      return errorResponse("No stored fields — run import-fields first", 404);
    }

    const scanned: Array<{ field: string; jd_field_id: string; application_count: number }> = [];
    let sample: SampleResult | null = null;

    for (const field of fields as FieldRow[]) {
      const listResp = await callJohnDeereApi(
        accessToken,
        `/organizations/${orgId}/fields/${field.jd_field_id}/fieldOperations?fieldOperationType=APPLICATION`,
      );

      if (!listResp.ok) {
        scanned.push({ field: field.name, jd_field_id: field.jd_field_id, application_count: -1 });
        continue;
      }

      const listData = await listResp.json();
      const ops: JdOperation[] = listData.values || [];
      scanned.push({
        field: field.name,
        jd_field_id: field.jd_field_id,
        application_count: ops.length,
      });

      if (ops.length > 0 && !sample) {
        const sampleOps = ops.slice(0, 3);
        const sampled: SampleResult["sampled_operations"] = [];

        for (const op of sampleOps) {
          const measResp = await fetch(
            `${JOHN_DEERE_API_BASE}/fieldOperations/${op.id}/measurementTypes/ApplicationRateResult`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.deere.axiom.v3+json",
                "Accept-UOM-System": "ENGLISH",
              },
            },
          );

          let measRaw: unknown;
          if (measResp.ok) {
            measRaw = await measResp.json();
          } else {
            const text = await measResp.text().catch(() => "");
            measRaw = { _error: { status: measResp.status, body: text.slice(0, 500) } };
          }

          sampled.push({
            operation_meta: {
              id: op.id,
              type: op.fieldOperationType,
              season: op.cropSeason,
              crop: op.cropName,
              startDate: op.startDate,
              endDate: op.endDate,
            },
            measurement_response_raw: measRaw,
          });
        }

        sample = {
          field: { id: field.jd_field_id, name: field.name },
          application_operations_found: ops.length,
          sampled_operations: sampled,
        };
        break;
      }
    }

    return jsonResponse({
      scanned_fields: scanned,
      sample,
      note: sample
        ? "Sample taken from first field with APPLICATION ops. Up to 3 ops shown."
        : "No APPLICATION operations found in the first 20 fields scanned.",
    });
  } catch (error) {
    console.error("[debug-spray-shape] Error:", error);
    return errorResponse("Internal error", 500);
  }
});
