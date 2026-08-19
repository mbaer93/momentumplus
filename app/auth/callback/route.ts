import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Exchanges an emailed link for a session, then redirects into the portal.
 *
 * THREE SHAPES arrive here, and which one depends on a Supabase email
 * template nobody can see from the code (2026-08-19 audit):
 *
 *   ?code=…          PKCE. Needs the verifier cookie from the browser that
 *                    REQUESTED it — so an admin-triggered reset, or an
 *                    email opened on a different device, cannot work.
 *   ?token_hash=…    Device-independent; handled by /auth/confirm.
 *   #access_token=…  The implicit flow, which Supabase still emits for
 *                    plain {{ .ConfirmationURL }} invites. A FRAGMENT IS
 *                    NEVER SENT TO THE SERVER, so this route used to see an
 *                    empty query, call the link mangled, and throw away a
 *                    perfectly good session while the member read "that
 *                    link didn't come through cleanly".
 *
 * All three now work. On go-live a template change must not be able to
 * lock out every member at once, and the template is the one part of this
 * flow that lives outside the repo.
 */
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

  /*
   * No ?code. Before calling the link dead, hand the browser a page that
   * can look at the FRAGMENT — the one place the server cannot. An
   * implicit-flow link carries the whole session there.
   */
  return new NextResponse(fragmentHandoffPage(redirectTo, isRecovery), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Accepts the tokens the fragment page found and turns them into cookies.
 *
 * Same-origin POST of the member's own session. Nothing here is logged:
 * a refresh token in a log line is a permanent account key sitting in
 * plain text.
 */
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const accessToken = String(form?.get("access_token") ?? "");
  const refreshToken = String(form?.get("refresh_token") ?? "");
  const redirectRaw = String(form?.get("redirect") ?? "/dashboard");
  const redirectTo =
    redirectRaw.startsWith("/") && !redirectRaw.startsWith("//")
      ? redirectRaw
      : "/dashboard";

  if (!accessToken || !refreshToken || !isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login`, 303);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That sign-in link has expired. Enter your email below for a fresh one.",
      )}`,
      303,
    );
  }
  return NextResponse.redirect(`${origin}${redirectTo}`, 303);
}

/*
 * The fragment is readable only in the browser, so this is the one place a
 * script is doing real work rather than saving a click. It submits ONLY
 * when a fragment actually carries tokens — a mail scanner fetching the
 * bare URL finds no fragment, submits nothing, and consumes nothing.
 */
function fragmentHandoffPage(redirectTo: string, isRecovery: boolean): string {
  const fallback = isRecovery
    ? `/reset?error=${encodeURIComponent(
        "That reset link didn't come through cleanly. Enter your email and we'll send a fresh one.",
      )}`
    : `/login?error=${encodeURIComponent(
        "That link didn't come through cleanly — sign in below, or use Forgot password for a fresh link.",
      )}`;
  const json = (v: string) => JSON.stringify(v);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Signing you in | Momentum+</title>
</head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#0B1622;color:#F8F6F1;display:flex;min-height:100dvh;align-items:center;justify-content:center;">
  <noscript>
    <p style="font-size:14px;">Turn on JavaScript to finish signing in, or
    <a style="color:#B8965A;" href="${fallback}">request a fresh link</a>.</p>
  </noscript>
  <form id="f" method="POST" action="/auth/callback" style="display:none;">
    <input type="hidden" name="access_token" id="a" />
    <input type="hidden" name="refresh_token" id="r" />
    <input type="hidden" name="redirect" value="${redirectTo.replace(/"/g, "&quot;")}" />
  </form>
  <p style="font-size:14px;opacity:.8;">Signing you in&hellip;</p>
<script>
(function () {
  var h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var at = h.get("access_token"), rt = h.get("refresh_token");
  if (at && rt) {
    document.getElementById("a").value = at;
    document.getElementById("r").value = rt;
    // Drop the tokens out of the address bar before anything can copy it.
    history.replaceState(null, "", location.pathname + location.search);
    document.getElementById("f").submit();
    return;
  }
  var err = h.get("error_description") || h.get("error");
  location.replace(err
    ? ${json(isRecovery ? "/reset?error=" : "/login?error=")} + encodeURIComponent(err)
    : ${json(fallback)});
})();
</script>
</body>
</html>`;
}
