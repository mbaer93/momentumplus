import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { momentumUrl } from "@/lib/momentum";

/*
 * Token-hash verification for emailed links (invite, recovery, magic link),
 * mirroring the Momentum+ handler. Recovery is the one flow this app doesn't
 * host — password resets run through the Momentum+ site (same account), so
 * recovery links that land here are forwarded there.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirectRaw = searchParams.get("redirect") || "/";
  // Same-origin paths only — never an outside host.
  const redirectTo =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/";

  if (tokenHash && type && isSupabaseConfigured()) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as
        | "invite"
        | "recovery"
        | "signup"
        | "email"
        | "email_change"
        | "magiclink",
    });
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(momentumUrl("/welcome?mode=reset"));
      }
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That link is invalid or has expired — sign in below or request a fresh link.",
      )}`,
    );
  }
  return NextResponse.redirect(`${origin}/login`);
}
