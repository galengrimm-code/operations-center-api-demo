import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cookie-based session storage (via @supabase/ssr) so the server-side
// middleware (middleware.ts, createServerClient) can read the auth session.
// A plain createClient stores the session in localStorage, which the server
// cannot see — that bounced authenticated users off all (app)/* routes.
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
  db: { schema: "operations_center" },
});
