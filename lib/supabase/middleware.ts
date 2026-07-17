import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Portal + admin route prefixes that require an authenticated, active member.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/community",
  "/sessions",
  "/library",
  "/education",
  "/speakers",
  "/resources",
  "/sponsors",
  "/calendar",
  "/profile",
  "/admin",
  "/welcome",
  // Sponsor-rep onboarding: requires sign-in but NOT an active membership
  // (the form itself grants the membership).
  "/sponsor-onboarding",
];

const AUTH_PATHS = ["/login", "/reset"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Purely public, never-personalized paths: no session refresh needed, so
// skip the Supabase Auth round trip entirely (robots/sitemap/og are hit by
// crawlers constantly; /privacy and /terms render the same for everyone).
const AUTH_FREE_PATHS = new Set([
  "/privacy",
  "/terms",
  "/robots.txt",
  "/sitemap.xml",
  "/og.png",
  "/manifest.webmanifest",
]);

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (AUTH_FREE_PATHS.has(request.nextUrl.pathname)) return response;

  // Phase 1 dev convenience: without Supabase env configured, skip auth so the
  // shell is viewable — LOCAL DEV ONLY. On any deployed environment, missing
  // Supabase env vars are a misconfiguration; failing open would serve the
  // entire members-only portal (and admin) to the public with no login.
  if (!isSupabaseConfigured()) {
    if (process.env.VERCEL) {
      return new NextResponse(
        "Momentum+ is misconfigured: Supabase environment variables are not set for this deployment.",
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

  // Unauthenticated user hitting a protected route → send to login.
  if (!user && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting an auth page → send to dashboard.
  if (user && AUTH_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
