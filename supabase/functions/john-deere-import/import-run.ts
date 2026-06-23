// Durable status for long imports. The edge gateway 504s the browser at ~150s,
// but this function keeps running to completion server-side. We record each
// import run in operations_center.import_runs so the client can poll for the
// outcome instead of holding the connection open. See lib/john-deere-client.ts.
//
// The run id is minted by the CLIENT and passed in, so the client polls by exact
// id (no cross-tab / cross-org cross-talk, no timestamp-skew guessing).
//
// Status bookkeeping must NEVER fail the import — every error AND thrown exception
// here is logged and swallowed so a hiccup writing the status row can't abort (or
// falsely fail) a working import.
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRunId(id: string | null): id is string {
  return !!id && UUID_RE.test(id);
}

export async function beginImportRun(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  orgId: string,
  action: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("import_runs")
      .insert({ id: runId, user_id: userId, org_id: orgId, action });
    if (error) console.error("[import-run] failed to begin run:", error.message);
  } catch (e) {
    console.error("[import-run] begin run threw:", e instanceof Error ? e.message : e);
  }
}

export async function finishImportRun(
  supabase: SupabaseClient,
  runId: string,
  status: "done" | "error",
  result?: Record<string, unknown>,
  errorCode?: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("import_runs")
      .update({
        status,
        result: result ?? null,
        error_code: errorCode ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (error) console.error("[import-run] failed to finish run:", error.message);
  } catch (e) {
    console.error("[import-run] finish run threw:", e instanceof Error ? e.message : e);
  }
}
