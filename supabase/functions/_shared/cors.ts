const DEFAULT_ORIGIN = "https://operations-center-api-demo.vercel.app";

const ALLOWED_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "http://localhost:3000",
  // add Vercel preview origins explicitly here if needed: "https://operations-center-api-demo-git-*.vercel.app"
]);

function resolveOrigin(req: Request | undefined): string {
  if (!req) return DEFAULT_ORIGIN; // safe default for non-request contexts
  const origin = req.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
}

function corsHeaders(req?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

export function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function errorResponse(
  error: string,
  status = 400,
  details?: string,
  req?: Request,
): Response {
  return jsonResponse({ error, ...(details ? { details } : {}) }, status, req);
}

export function optionsResponse(req?: Request): Response {
  return new Response(null, { status: 200, headers: corsHeaders(req) });
}
