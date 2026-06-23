import { supabase } from "./supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  console.log("[john-deere-client] Session:", session ? "exists" : "null");
  if (!session) {
    throw new Error("Not authenticated");
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
}

// Edge functions return { error: "request_failed", code: "FN_CODE" } on failure
// (generic-error hardening) — surface the stable code with a readable fallback
// instead of showing the bare "request_failed" string in the UI.
function apiErrorMessage(
  error: { error?: string; code?: string } | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.code) return `${fallback} (${error.code})`;
  if (error.error && error.error !== "request_failed") return error.error;
  return fallback;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  console.log("[john-deere-client] Exchanging code for tokens...");
  console.log("[john-deere-client] Redirect URI:", redirectUri);

  const headers = await getAuthHeaders();
  console.log("[john-deere-client] Headers prepared, making request...");

  const url = `${SUPABASE_URL}/functions/v1/john-deere-auth?action=exchange`;
  console.log("[john-deere-client] URL:", url);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ code, redirectUri }),
  });

  console.log("[john-deere-client] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error("[john-deere-client] Error response:", error);
    throw new Error(apiErrorMessage(error, "Failed to exchange code"));
  }

  const result = await response.json();
  console.log("[john-deere-client] Exchange successful");
  return result;
}

export async function refreshJohnDeereToken() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-auth?action=refresh`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to refresh token"));
  }

  return response.json();
}

export async function disconnectJohnDeere() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-auth?action=disconnect`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to disconnect"));
  }

  return response.json();
}

export async function fetchOrganizations() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=organizations`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to fetch organizations"));
  }

  return response.json();
}

export async function selectOrganization(orgId: string, orgName: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-api?action=select-organization`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ orgId, orgName }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to select organization"));
  }

  return response.json();
}

export async function fetchFields() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=fields`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to fetch fields"));
  }

  return response.json();
}

// Full imports fire hundreds of John Deere API calls and routinely run past the
// ~150s Supabase edge gateway timeout. The browser then gets a 504 while the
// function keeps running to completion server-side and commits its outcome to
// operations_center.import_runs. Rather than hold the connection open (and show a
// scary 504 on an import that actually succeeds), we poll that durable status row
// for completion — the same shape as pollForShapefileUrl above.
const IMPORT_POLL_MAX_ATTEMPTS = 90; // ceiling ~14 min (6×5s then 84×10s)
const IMPORT_NO_ROW_GIVE_UP_ATTEMPT = 6; // ~30s: the run row should exist by now

function importPollDelay(attempt: number): number {
  return attempt <= 6 ? 5_000 : 10_000;
}

// Poll the durable run row by its exact (client-minted) id. RLS scopes reads to
// the current user, and the id is unique per run, so there is no cross-tab /
// cross-org cross-talk and no timestamp-skew guessing.
async function pollImportRun(runId: string): Promise<unknown> {
  let sawRow = false;
  for (let attempt = 1; attempt <= IMPORT_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, importPollDelay(attempt)));

    const { data } = await (supabase.from("import_runs") as any)
      .select("status, result, error_code")
      .eq("id", runId)
      .maybeSingle();

    const run = data as { status: string; result: unknown; error_code: string | null } | null;
    if (!run) {
      // The function writes the 'running' row within ~2s of receiving the request
      // (and on a 504 the row exists long before we start polling). If no row has
      // appeared after ~30s, the POST never reached the server (offline / DNS /
      // CORS) — fail fast instead of waiting out the full ceiling.
      if (!sawRow && attempt >= IMPORT_NO_ROW_GIVE_UP_ATTEMPT) {
        throw new Error(
          "Import didn't start — couldn't reach the server. Check your connection and try again.",
        );
      }
      continue;
    }
    sawRow = true;
    if (run.status === "done") return run.result ?? {};
    if (run.status === "error") {
      throw new Error(apiErrorMessage({ code: run.error_code ?? undefined }, "Import failed"));
    }
    // status === 'running' — keep polling
  }
  throw new Error(
    "Import is still running on the server. It should finish shortly — refresh in a minute to see the imported data.",
  );
}

// Fire an import, then resolve via either the direct response (small orgs that
// finish under the gateway timeout) or — on a 504 / dropped connection — by
// polling the durable import-run status. Returns the run result/summary.
async function runImportWithPoll(baseUrl: string): Promise<unknown> {
  const headers = await getAuthHeaders();
  // The client mints the run id and passes it in, so it can poll that exact row.
  const runId = crypto.randomUUID();
  const requestUrl = `${baseUrl}&runId=${runId}`;

  let response: Response | null = null;
  try {
    response = await fetch(requestUrl, { method: "POST", headers });
  } catch {
    response = null; // connection dropped mid-import; the function runs on — poll
  }

  if (response) {
    if (response.ok) return response.json(); // finished under the gateway timeout
    if (response.status !== 504) {
      const error = await response.json().catch(() => ({}));
      throw new Error(apiErrorMessage(error, `Failed to import (${response.status})`));
    }
    // 504 gateway timeout → still running server-side; poll the durable status row.
  }

  return pollImportRun(runId);
}

export async function importFieldsWithBoundaries() {
  const result = (await runImportWithPoll(
    `${SUPABASE_URL}/functions/v1/john-deere-import?action=import-fields`,
  )) as { fields?: unknown[] } & Record<string, unknown>;

  // Fast path already includes the fields array; the poll path returns only the
  // summary, so re-fetch the stored fields to keep the { fields, ... } contract.
  if (result && Array.isArray(result.fields)) return result;
  const { fields } = await fetchStoredFields();
  return { fields: fields || [], ...(result || {}) };
}

export async function importOperations() {
  return runImportWithPoll(
    `${SUPABASE_URL}/functions/v1/john-deere-import?action=import-operations`,
  );
}

export interface ImportApplicationsResult {
  operations_processed: number;
  product_lines_written: number;
  measurements_not_found: number;
  measurements_error: number;
}

export async function importApplications(fieldId?: string): Promise<ImportApplicationsResult> {
  const headers = await getAuthHeaders();
  // Per-field scoping keeps each request small so it can't hit the gateway
  // timeout — the page drives the loop over all fields and shows progress.
  const scope = fieldId ? `&fieldId=${encodeURIComponent(fieldId)}` : "";
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-import?action=import-applications${scope}`,
    {
      method: "POST",
      headers,
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(error, `Failed to import applications (${response.status})`));
  }

  return response.json();
}

export async function importFieldOperations(fieldId: string): Promise<{ totalImported: number }> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-import?action=import-field-operations&fieldId=${encodeURIComponent(fieldId)}`,
    { method: "POST", headers },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to import field operations"));
  }

  return response.json();
}

export async function fetchStoredOperations(fieldId?: string, operationType?: string) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ action: "get-stored-operations" });
  if (fieldId) params.set("fieldId", fieldId);
  if (operationType) params.set("operationType", operationType);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?${params.toString()}`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to fetch stored operations"));
  }

  return response.json();
}

export async function fetchStoredFields() {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-api?action=get-stored-fields`,
    {
      headers,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to fetch stored fields"));
  }

  return response.json();
}

export async function fetchIrrigationAnalysis(fieldId: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-irrigation?action=irrigation-analysis&fieldId=${encodeURIComponent(fieldId)}`,
    { headers },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(apiErrorMessage(error, "Failed to fetch irrigation analysis"));
  }

  return response.json();
}

export async function pollForShapefileUrl(
  operationId: string,
  onProgress?: (attempt: number, status: string) => void,
  resolution?: "EachSensor" | "OneHertz",
): Promise<string> {
  // Budget: up to ~20 minutes total. JD usually finishes in 1-3 min, but
  // some large / dense operations take 10-15 min. Backoff starts fast
  // (5s) and ramps to 20s so we don't spam when it's clearly going to be slow.
  const maxAttempts = 120;
  const startedAt = Date.now();

  const backoffMs = (attempt: number): number => {
    if (attempt <= 6) return 5_000; // first 30s: poll every 5s
    if (attempt <= 20) return 10_000; // next ~2.5 min: every 10s
    return 20_000; // after that: every 20s
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt, "polling");

    // Fresh headers every attempt — a poll can outlive the access token on
    // long JD generations, and getSession() auto-refreshes an expired token.
    const headers = await getAuthHeaders();

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/john-deere-irrigation?action=shapefile-status&operationId=${encodeURIComponent(operationId)}${
        resolution ? `&resolution=${resolution}` : ""
      }`,
      { headers },
    );

    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      continue;
    }

    if (!response.ok) {
      let errorMsg = "Failed to check shapefile status";
      try {
        const error = await response.json();
        errorMsg = apiErrorMessage(error, errorMsg);
      } catch {
        /* response not JSON */
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    if (data.status === "ready" && data.storagePath) {
      return data.storagePath as string;
    }

    throw new Error("Unexpected shapefile status response");
  }

  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  throw new Error(
    `Shapefile still processing after ${elapsedMin} min. John Deere is taking unusually long on this operation — try again in a few minutes (the next attempt will pick up where this one left off).`,
  );
}

export function getJohnDeereAuthUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_JOHN_DEERE_CLIENT_ID || "",
    response_type: "code",
    redirect_uri: redirectUri,
    // Read-only scopes. ag2+ag3 are REQUIRED to read APPLICATION/chemical/tank-mix
    // data (ag1 alone only exposes harvest/seeding — confirmed 2026-06-01 when the
    // spray import returned 0 under an ag1-only token). org2/work2 stay dropped (write/
    // multi-org, not needed). Do not trim ag2/ag3 without breaking the applications feature.
    scope: "ag1 ag2 ag3 org1 work1 offline_access",
    state,
  });

  return `https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize?${params.toString()}`;
}
