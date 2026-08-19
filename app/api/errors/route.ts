import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl } from "@/lib/notifications";
import {
  EMAIL_THROTTLE_MS,
  anonymousBucket,
  errorFingerprint,
  throttleExpired,
} from "@/lib/error-report-guards";

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
  const hash = errorFingerprint(message, path);

  // Only an ACTIVE member may create rows or trigger alerts. A signed-in
  // but never-paid / lapsed account (or anonymous visitor) can't — that
  // was the inbox-bombing vector.
  let authenticated = false;
  try {
    const { getCurrentMember } = await import("@/lib/current-member");
    const member = await getCurrentMember();
    authenticated = Boolean(member?.membershipActive);
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

  if (!authenticated) {
    /*
     * Anonymous reports used to be recorded NOWHERE (bots could otherwise
     * inflate "Occurrences" or spam rows). But /join and /tickets crash
     * for VISITORS — signed-out people trying to PAY — and losing those
     * reports left revenue-path breakage invisible (audit P2-21).
     * Abuse-bounded compromise: anonymous reports on those two paths land
     * in ONE fixed row per path (hash derived from the path alone, not
     * attacker-controlled text), never email, never ring the bell. A bot
     * can only ever bump two counters.
     */
    const bucket = anonymousBucket(path);
    if (bucket) {
      const { hash: anonHash, path: publicPath } = bucket;
      const anonMessage = `Anonymous visitor crash on ${publicPath}: ${message}`.slice(0, 500);
      const { data: anonRow } = await admin
        .from("error_reports")
        .select("hash, count")
        .eq("hash", anonHash)
        .maybeSingle();
      if (anonRow) {
        await admin
          .from("error_reports")
          .update({
            count: Number(anonRow.count ?? 0) + 1,
            last_seen: nowIso,
            message: anonMessage,
          })
          .eq("hash", anonHash);
      } else {
        await admin.from("error_reports").insert({
          hash: anonHash,
          message: anonMessage,
          path: publicPath,
          count: 1,
          first_seen: nowIso,
          last_seen: nowIso,
        });
      }
    }
    return NextResponse.json({ ok: true, anonymous: true });
  }

  if (existing) {
    await admin
      .from("error_reports")
      .update({ count: (existing.count as number) + 1, last_seen: nowIso, message, path })
      .eq("hash", hash);
  } else {
    await admin
      .from("error_reports")
      .insert({ hash, message, path, count: 1, first_seen: nowIso, last_seen: nowIso });
  }

  // Record WHO hit it (migration 0061), so an admin can email exactly the
  // affected members from Admin → Platform Errors. Best-effort: a missing
  // table (pre-0061) must not break the report.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: hit } = await admin
        .from("error_report_hits")
        .select("hits")
        .eq("hash", hash)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (hit) {
        await admin
          .from("error_report_hits")
          .update({ hits: (hit.hits as number) + 1, last_hit: nowIso })
          .eq("hash", hash)
          .eq("profile_id", user.id);
      } else {
        await admin
          .from("error_report_hits")
          .insert({ hash, profile_id: user.id });
      }
    }
  } catch {
    /* best-effort */
  }

  if (
    !throttleExpired(existing?.last_emailed_at as string | null, Date.now())
  ) {
    return NextResponse.json({ ok: true, throttled: true });
  }

  // GLOBAL throttle across ALL distinct errors: without this, a member
  // hitting (or forging) many UNIQUE messages emails Matt once per unique
  // hash. Cap the alert inbox to one email per throttle window no matter
  // how many different errors fire. The row + bell notice still record.
  const { data: recent } = await admin
    .from("error_reports")
    .select("last_emailed_at")
    .not("last_emailed_at", "is", null)
    .order("last_emailed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emailAllowed = throttleExpired(
    recent?.last_emailed_at as string | null,
    Date.now(),
  );

  // Email every Super Admin (today: Matt).
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("admin_role", "super");
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let emailed = 0;
  for (const s of emailAllowed ? (supers ?? []) : []) {
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
      <p style="margin:14px 0 0;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co"}/admin/errors" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;padding:9px 16px;border-radius:4px;text-decoration:none;">See who was affected &amp; notify them</a>
      </p>
      <p style="margin:8px 0 0;font-size:12px;">
        Admin panel not loading either? Use the break-glass
        <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co"}/rescue" style="color:#B8965A;font-weight:bold;"> rescue console</a> — it works even when the portal is down.
      </p>
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
  // Same global throttle as email: without it, unique forged messages ring
  // the bell once each even while the email side stays capped.
  if (emailAllowed && supers?.length) {
    await admin.from("notifications").insert(
      supers.map((s) => ({
        profile_id: s.id,
        kind: "platform",
        title: "Error alert: a member hit a crash screen",
        body: `${path || "unknown page"} — ${message.slice(0, 120)}`,
        link: "/admin/errors",
      })),
    );
  }

  return NextResponse.json({ ok: true, emailed });
}
