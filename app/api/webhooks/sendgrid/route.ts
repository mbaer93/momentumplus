import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * SendGrid Event Webhook: auth emails (invites, password resets, login
 * links) that BOUNCE, get BLOCKED, are DROPPED, or are marked spam used to
 * fail invisibly — the app said "invite sent" while the member never got
 * it. SendGrid POSTs delivery events here; failures alert every Super
 * Admin via the bell AND a GHL email (a different pipe than the failing
 * one, so the alert itself can't be swallowed by the same outage).
 *
 * Setup (SendGrid → Settings → Mail Settings → Event Webhook):
 *   URL: https://momentumplus.co/api/webhooks/sendgrid?token=<SENDGRID_WEBHOOK_TOKEN>
 *   Events: Bounced, Blocked, Dropped, Spam Reports (delivery noise like
 *   processed/delivered/open stays OFF — we only want failures).
 */

const ALERT_EVENTS = new Set(["bounce", "blocked", "dropped", "spamreport"]);
// One webhook POST can carry many events (bulk invite to a bad list) —
// list this many in the alert, summarize the rest.
const MAX_LISTED = 20;

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.SENDGRID_WEBHOOK_TOKEN;
  if (!expected) return false;
  const got = req.nextUrl.searchParams.get("token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, note: "no database" });
  }
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let events: {
    email?: string;
    event?: string;
    reason?: string;
    response?: string;
    type?: string;
  }[];
  try {
    const body = (await req.json()) as unknown;
    events = Array.isArray(body) ? body : [];
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const failures = events
    .filter((e) => e.event && ALERT_EVENTS.has(e.event))
    .map((e) => ({
      email: String(e.email ?? "unknown"),
      event: String(e.event),
      reason: String(e.reason ?? e.response ?? e.type ?? "").slice(0, 200),
    }));
  if (failures.length === 0) {
    return NextResponse.json({ ok: true, failures: 0 });
  }

  const admin = createServiceClient();
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email")
    .eq("admin_role", "super");

  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const listed = failures.slice(0, MAX_LISTED);
  const lines = listed
    .map(
      (f) =>
        `<p style="margin:0 0 8px;"><strong>${esc(f.email)}</strong> — ${esc(f.event)}${f.reason ? `: ${esc(f.reason)}` : ""}</p>`,
    )
    .join("");
  const more =
    failures.length > MAX_LISTED
      ? `<p style="margin:0 0 8px;">…and ${failures.length - MAX_LISTED} more (see SendGrid → Activity).</p>`
      : "";

  // Bell first — it works even if GHL is down.
  if (supers?.length) {
    await admin.from("notifications").insert(
      supers.map((s) => ({
        profile_id: s.id,
        kind: "platform",
        title: `Email delivery problem: ${failures.length} message${failures.length === 1 ? "" : "s"} not delivered`,
        body: listed
          .map((f) => `${f.email} (${f.event})`)
          .join(", ")
          .slice(0, 300),
        link: "/admin/members",
      })),
    );
  }

  let emailed = 0;
  for (const s of supers ?? []) {
    if (!s.email) continue;
    const res = await sendEmailViaGhl({
      email: s.email as string,
      subject: `[Momentum+ ALERT] ${failures.length} email${failures.length === 1 ? "" : "s"} not delivered`,
      html: brandedEmailHtml({
        greetingName: "",
        heading: "Email delivery problem",
        bodyHtml: `
          <p style="margin:0 0 12px;">SendGrid couldn't deliver account email (invite, password reset, or login link) to:</p>
          ${lines}${more}
          <p style="margin:12px 0 0;">Blocked/bounced addresses stay suppressed until cleared: SendGrid &rarr; Suppressions. After clearing (or fixing a typo in Admin &rarr; Members), re-send the invite.</p>`,
        ctaLabel: "Open SendGrid Activity",
        ctaUrl: "https://app.sendgrid.com/email_activity",
        footnote:
          "Sent because SendGrid reported a delivery failure. This alert travels via GHL, so it arrives even when SendGrid is the problem.",
      }),
    });
    if (res.sent) emailed++;
  }

  return NextResponse.json({ ok: true, failures: failures.length, emailed });
}
