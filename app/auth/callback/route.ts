import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Exchanges the auth code (magic link / password reset / OAuth) for a session,
// then redirects into the portal. See Supabase SSR auth flow.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectRaw = searchParams.get("redirect") || "/dashboard";
  // Same-origin paths only — "@evil.com" / "//evil.com" style values must
  // never turn this trusted endpoint into an open redirect.
  const redirectTo =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/dashboard";

  /*
   * A recovery link that fails to exchange must land on the RESET form, not
   * the sign-in form. The PKCE code verifier lives in the browser that
   * REQUESTED the reset, so opening the email on a phone — or letting a
   * corporate mail scanner fetch the link first — fails here through no
   * fault of the member. Sending them to a password box then answers
   * "Invalid login credentials", which reads as "your password is wrong"
   * and starts the loop again (reported by a speaker, 2026-08-18).
   */
  const isRecovery =
    redirectTo.includes("mode=reset") ||
    searchParams.get("type") === "recovery";
  const deadLink = (message: string) =>
    NextResponse.redirect(
      `${origin}${isRecovery ? "/reset" : "/login"}?error=${encodeURIComponent(message)}`,
    );

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return deadLink(
      isRecovery
        ? "That reset link has already been used or was opened on a different device. Enter your email for a fresh one."
        : "Sign-in link is invalid or expired.",
    );
  }

  // No code at all = a truncated or mangled link. Forwarding unauthenticated
  // used to bounce members through /login into the onboarding wizard —
  // say what actually happened instead.
  return deadLink(
    isRecovery
      ? "That reset link didn't come through cleanly. Enter your email and we'll send a fresh one."
      : "That link didn't come through cleanly — sign in below, or use Forgot password for a fresh link.",
  );
}
