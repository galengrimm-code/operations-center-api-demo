// middleware.ts
// Server-side auth gate for protected routes. Runs before page HTML renders.
// Public routes: /, /login, /auth/callback, static assets.
// Protected: everything under app/(app)/ — /map, /fields, /operations, /applications, /products, /settings, /dashboard.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

const PUBLIC_FILE_EXT =
  /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|eot|webmanifest|txt)$/;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Always allow public paths + static files + Next internals
  if (
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") || // API routes handle their own auth
    PUBLIC_FILE_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Validate session via Supabase SSR
  let response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes EXCEPT static files and Next internals (matched via PUBLIC paths above too — defense in depth)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
