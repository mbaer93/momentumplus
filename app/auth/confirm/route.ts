import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Token-hash verification for emailed links (invite, recovery, signup,
 * email change). Unlike /auth/callback (PKCE ?code=), this works no matter
 * which browser or device opens the link — the Supabase SSR pattern.
 * Links look like: /auth/confirm?token_hash=...&type=invite&redirect=/welcome
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirectRaw = searchParams.get("redirect") || "/welcome";
  // Same-origin paths only — never an outside host.
  const redirectTo =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/welcome";

  if (tokenHash && type && isSupabaseConfigured()) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "recovery" | "signup" | "email" | "email_change" | "magiclink",
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That link is invalid or has expired — use Forgot password to get a fresh one.",
      )}`,
    );
  }
  return NextResponse.redirect(`${origin}/login`);
}
