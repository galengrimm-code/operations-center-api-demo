import { createClient, SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { errorResponse } from "./cors.ts";

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: 'operations_center' }
  });
}

export interface AuthResult {
  user: User;
  supabase: SupabaseClient;
}

export async function getAuthenticatedUser(req: Request): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("No authorization header", 401);
  }

  const supabase = createServiceClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return errorResponse("Invalid user token", 401);
  }

  return { user, supabase };
}

export function isResponse(result: AuthResult | Response): result is Response {
  return result instanceof Response;
}
