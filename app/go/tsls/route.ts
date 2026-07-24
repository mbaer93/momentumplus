import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/*
 * One-click crossover from Momentum+ INTO the TSLS event app. We hand the
 * signed-in member's verified email to TSLS's SSO handoff and redirect
 * straight into a TSLS session. Members who don't have a TSLS account yet
 * (Momentum+-only subscribers, no ticket) get a 404 from TSLS and are sent
 * to the public event app instead. Mirror of TSLS's /go/momentum.
 *
 * Config (Momentum+ env):
 *   NEXT_PUBLIC_TSLS_EVENT_URL = the TSLS event app base URL (public; also
 *                                gates the sidebar link)
 *   TSLS_SSO_KEY               = TSLS's TSLS_SSO_SECRET (server-only)
 */

function tslsBase(): string {
  return (process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "").replace(/\/$/, "");
}

async function tslsSsoUrl(
  email: string,
  redirect: string,
): Promise<{ url: string | null; why: string }> {
  const base = tslsBase();
  const key = process.env.TSLS_SSO_KEY;
  if (!base || !key) return { url: null, why: "unconfigured" };
  try {
    const res = await fetch(`${base}/api/sso/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ email, redirect }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !data.url) return { url: null, why: String(res.status) };
    return { url: data.url, why: "ok" };
  } catch {
    return { url: null, why: "network" };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const toRaw = searchParams.get("to") ?? "";
  const to = toRaw.startsWith("/") && !toRaw.startsWith("//") ? toRaw : "/";

  const base = tslsBase();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let why = "signed-out";
  if (user?.email) {
    const sso = await tslsSsoUrl(user.email, to);
    if (sso.url) return NextResponse.redirect(sso.url);
    why = sso.why;
    // Diagnosable, not silent: the failure reason lands in Vercel's function
    // logs (no member PII) and in the fallback URL below, so "it sent me to
    // a login page" can be traced to 401 (key mismatch), 404 (no TSLS
    // account for this email), 5xx (TSLS-side error), or network.
    console.log(`[go/tsls] sso handoff failed: ${why}`);
  }
  // Momentum+-only (no event account) or SSO off → the public event app.
  if (!base) return NextResponse.redirect(new URL("/dashboard", req.url));
  const sep = to.includes("?") ? "&" : "?";
  return NextResponse.redirect(`${base}${to}${sep}mp_sso=${why}`);
}
