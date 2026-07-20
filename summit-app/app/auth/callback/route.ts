import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Exchanges the auth code (magic link / password reset / OAuth) for a session,
// then redirects into the portal. See Supabase SSR auth flow.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectRaw = searchParams.get("redirect") || "/";
  // Same-origin paths only — "@evil.com" / "//evil.com" style values must
  // never turn this trusted endpoint into an open redirect.
  const redirectTo =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/";

  if (code && isSupabaseConfigured()) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign-in link is invalid or expired.")}`,
    );
  }

  // No code at all = a truncated or mangled link. Forwarding unauthenticated
  // used to bounce members through /login into the onboarding wizard —
  // say what actually happened instead.
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "That link didn't come through cleanly — sign in below, or use Forgot password for a fresh link.",
    )}`,
  );
}
