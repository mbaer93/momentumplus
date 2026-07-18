import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl } from "@/lib/notifications";

/*
 * Error monitor: the error boundaries POST here when a member hits a crash
 * screen. Reports are fingerprinted and journaled in error_reports; each
 * distinct error emails the Super Admin(s) at most once every 6 hours no
 * matter how many members hit it — visibility without an inbox storm.
 *
 * Abuse guard: the endpoint is public (error boundaries fire for signed-out
 * visitors too), so anonymous reports may only bump the counter on errors
 * we've already seen — they can never create rows, email Matt, or ring the
 * admin bell. Signed-in reports get the full pipeline.
 */

const EMAIL_THROTTLE_MS = 6 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, note: "no database" });
  }

  let body: { message?: string; path?: string; digest?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const message = String(body.message ?? "Unknown error").slice(0, 500);
  const path = String(body.path ?? "").slice(0, 300);
  const digest = String(body.digest ?? "").slice(0, 100);
  const hash = createHash("sha256")
    .update(`${message}|${path}`)
    .digest("hex")
    .slice(0, 32);

  let authenticated = false;
  try {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    authenticated = Boolean(user);
  } catch {
    authenticated = false;
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: existing, error: readError } = await admin
    .from("error_reports")
    .select("hash, count, last_emailed_at")
    .eq("hash", hash)
    .maybeSingle();
  if (readError) {
    // Pre-migration (0034): accept silently rather than erroring the
    // member's already-broken page further.
    return NextResponse.json({ ok: true, note: "error_reports table missing" });
  }

  if (existing) {
    await admin
      .from("error_reports")
      .update({ count: (existing.count as number) + 1, last_seen: nowIso, message, path })
      .eq("hash", hash);
  } else if (authenticated) {
    await admin
      .from("error_reports")
      .insert({ hash, message, path, count: 1, first_seen: nowIso, last_seen: nowIso });
  } else {
    // Anonymous + never-seen error: counted nowhere. Accepting it would let
    // anyone spam rows and alert emails with fabricated reports.
    return NextResponse.json({ ok: true, anonymous: true });
  }

  if (!authenticated) {
    // Counter bumped above; alerts stay member-triggered only.
    return NextResponse.json({ ok: true, anonymous: true });
  }

  const lastEmailed = existing?.last_emailed_at
    ? new Date(existing.last_emailed_at as string).getTime()
    : 0;
  if (Date.now() - lastEmailed < EMAIL_THROTTLE_MS) {
    return NextResponse.json({ ok: true, throttled: true });
  }

  // Email every Super Admin (today: Matt).
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("admin_role", "super");
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let emailed = 0;
  for (const s of supers ?? []) {
    if (!s.email) continue;
    const { data: membership } = await admin
      .from("memberships")
      .select("ghl_contact_id")
      .eq("profile_id", s.id)
      .not("ghl_contact_id", "is", null)
      .limit(1)
      .maybeSingle();
    const res = await sendEmailViaGhl({
      contactId: (membership?.ghl_contact_id as string) ?? null,
      email: s.email as string,
      subject: `[Momentum+ ALERT] Error on ${path || "the site"}`,
      html: `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#c0392b;font-weight:bold;">Error alert</p>
      <p style="margin:0 0 12px;line-height:1.6;">A member just hit an error screen on the platform.</p>
      <p style="margin:0 0 6px;"><strong>Where:</strong> ${esc(path || "unknown page")}</p>
      <p style="margin:0 0 6px;"><strong>Error:</strong> ${esc(message)}</p>
      ${digest ? `<p style="margin:0 0 6px;"><strong>Digest:</strong> ${esc(digest)}</p>` : ""}
      ${existing ? `<p style="margin:0 0 6px;"><strong>Occurrences:</strong> ${(existing.count as number) + 1} since first seen</p>` : ""}
      <p style="margin:12px 0 0;font-size:11.5px;color:#9ca3af;">
        You'll get at most one email per distinct error every 6 hours. Ask
        Claude to investigate this message if it keeps recurring.
      </p>
    </div>
  </div>`,
    });
    if (res.sent) emailed += 1;
  }

  if (emailed > 0 || (supers ?? []).length === 0) {
    await admin
      .from("error_reports")
      .update({ last_emailed_at: nowIso })
      .eq("hash", hash);
  }

  // Bell notification for supers as well — works even when GHL is down.
  if (supers?.length) {
    await admin.from("notifications").insert(
      supers.map((s) => ({
        profile_id: s.id,
        kind: "platform",
        title: "Error alert: a member hit a crash screen",
        body: `${path || "unknown page"} — ${message.slice(0, 120)}`,
        link: "/admin",
      })),
    );
  }

  return NextResponse.json({ ok: true, emailed });
}
