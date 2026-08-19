import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Token-hash verification for emailed links (invite, recovery, signup,
 * email change). Unlike /auth/callback (PKCE ?code=), this works no matter
 * which browser or device opens the link — the Supabase SSR pattern.
 * Links look like: /auth/confirm?token_hash=...&type=invite&redirect=/welcome
 *
 * TWO-STEP on purpose (Matt, 2026-07-30: "the first login link is
 * invalid"): corporate mail scanners (Outlook SafeLinks and friends) GET
 * every link in an email before the member ever clicks — and these tokens
 * are one-time, so a scanner's fetch could consume the invite and make the
 * human's real click fail. GET now renders a tiny auto-continue page and
 * only the POST verifies; scanners don't submit forms.
 */

const TYPES = [
  "invite",
  "recovery",
  "signup",
  "email",
  "email_change",
  "magiclink",
] as const;
type OtpType = (typeof TYPES)[number];

function esc(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeRedirect(raw: string | null): string {
  // Same-origin paths only — never an outside host.
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/welcome";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") ?? "";
  const redirect = safeRedirect(searchParams.get("redirect"));
  if (!tokenHash) return NextResponse.redirect(`${origin}/login`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Signing you in | Momentum+</title>
</head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#F8F6F1;color:#1a2332;display:flex;min-height:100dvh;align-items:center;justify-content:center;">
  <form method="POST" action="/auth/confirm" style="background:#ffffff;border:1px solid #E8E4DC;border-radius:4px;padding:34px 30px;max-width:380px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#0B1622;margin-bottom:10px;">Momentum<span style="color:#B8965A;">+</span></div>
    <p style="font-size:14px;line-height:1.6;margin:0 0 18px;">One tap and you&rsquo;re in.</p>
    <input type="hidden" name="token_hash" value="${esc(tokenHash)}" />
    <input type="hidden" name="type" value="${esc(type)}" />
    <input type="hidden" name="redirect" value="${esc(redirect)}" />
    <button type="submit" style="background:#B8965A;color:#0B1622;font-weight:bold;font-size:15px;padding:12px 26px;border:none;border-radius:4px;cursor:pointer;">Continue to sign in</button>
  </form>
  <script>document.forms[0].submit();</script>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const tokenHash = String(form?.get("token_hash") ?? "");
  const givenType = String(form?.get("type") ?? "");
  const redirectTo = safeRedirect(String(form?.get("redirect") ?? ""));

  if (tokenHash && isSupabaseConfigured()) {
    const supabase = await createClient();
    // Try the type the link claims first, then the other plausible ones —
    // a dashboard email template with the wrong `type=` (the magic-link
    // template pasted into the invite slot, say) must not strand a new
    // member. A mismatched type fails without consuming the token.
    const order: OtpType[] = [
      ...(TYPES.includes(givenType as OtpType) ? [givenType as OtpType] : []),
      ...TYPES.filter((t) => t !== givenType),
    ];
    let verifiedType: OtpType | null = null;
    for (const type of order) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (!error) {
        verifiedType = type;
        break;
      }
    }
    if (verifiedType) {
      // Recovery = an existing member resetting a forgotten password. Route
      // them to the reset-mode form (new password only) instead of the
      // new-member onboarding wizard — works even with older email
      // templates that still say redirect=/welcome.
      const finalRedirect =
        verifiedType === "recovery" ? "/welcome?mode=reset" : redirectTo;
      return NextResponse.redirect(`${origin}${finalRedirect}`, 303);
    }
    /*
     * Same reasoning as /auth/callback: a spent RECOVERY link belongs on the
     * reset form, not the sign-in form. One-time links are routinely
     * consumed by corporate mail scanners before the member ever clicks.
     */
    const wantedRecovery =
      givenType === "recovery" || redirectTo.includes("mode=reset");
    return NextResponse.redirect(
      wantedRecovery
        ? `${origin}/reset?error=${encodeURIComponent(
            "That reset link has expired or was already used. Enter your email and we'll send a fresh one.",
          )}`
        : `${origin}/login?error=${encodeURIComponent(
            "That link has expired. Enter your email below and choose “Email me a sign-in link” to get a fresh one.",
          )}`,
      303,
    );
  }
  return NextResponse.redirect(`${origin}/login`, 303);
}
