import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/*
 * The whole companion app is members-only: everything except the login page
 * and auth endpoints requires a signed-in user. Membership/expiry checks
 * happen in the (app) layout; RLS is the real gate underneath.
 */

const PUBLIC_PATHS = new Set(["/login", "/manifest.webmanifest"]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/auth/");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Local-dev convenience only: with no Supabase env the shell stays
  // viewable. On any deployed environment that's a misconfiguration —
  // never fail open on a members-only app.
  if (!isSupabaseConfigured()) {
    if (process.env.VERCEL) {
      return new NextResponse(
        "The Summit companion is misconfigured: Supabase environment variables are not set for this deployment.",
        { status: 503 },
      );
    }
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
