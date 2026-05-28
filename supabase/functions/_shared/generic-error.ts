// supabase/functions/_shared/generic-error.ts
// Generic error responder shared across functions. Never leaks error.message, error.stack,
// or upstream payloads. Server-side logs the full context; clients get a stable code.

import { jsonResponse } from "./cors.ts";

type ErrorCategory = "request_failed" | "unauthorized" | "not_found" | "validation_failed";

export function genericError(
  status: number,
  category: ErrorCategory,
  code: string,
  req?: Request,
): Response {
  return jsonResponse({ error: category, code }, status, req);
}

export function logAndRespond(
  status: number,
  category: ErrorCategory,
  code: string,
  err: unknown,
  context: Record<string, unknown> = {},
  req?: Request,
): Response {
  console.error(`[${code}]`, { ...context, error: serializeError(err) });
  return genericError(status, category, code, req);
}

function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Unknown", message: String(err) };
}
