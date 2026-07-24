import { NextResponse, type NextRequest } from "next/server";
import { bearerAuthorized } from "@/lib/db-utils";
import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl } from "@/lib/notifications";
import {
  SPEAKER_REVENUE_SHARE,
  eligibleMemberCount,
  formatCents,
  monthKeyOf,
  monthLabel,
  monthWindow,
  monthlyEquivalentRevenueCents,
} from "@/lib/revenue";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Monthly operations report for Super Admins (Matt, 2026-07-24). Runs on
 * the 1st and covers the month that just closed: members on the platform,
 * monthly-equivalent revenue, the speaker of the month and their 15%,
 * every session held with its engagement rate, new members, and email
 * delivery health. Sent by email via GHL + a bell notification.
 *
 * Idempotent: app_settings key "monthly_report_last" records the last
 * month reported; re-runs (or a mid-month manual hit) skip cleanly.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SENT_KEY = "monthly_report_last";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();

  // The month that just ended (ET): step back from mid-previous-month.
  const now = new Date();
  const thisMonthStart = monthWindow(monthKeyOf(now)).start;
  const reportKey = monthKeyOf(new Date(thisMonthStart.getTime() - 15 * 24 * 3600 * 1000));
  const { start, end } = monthWindow(reportKey);
  const label = monthLabel(reportKey);

  const { data: sentRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SENT_KEY)
    .maybeSingle();
  if ((sentRow?.value as { month?: string } | null)?.month === reportKey) {
    return NextResponse.json({ ok: true, skipped: "already sent", month: reportKey });
  }

  // ---- Gather the numbers --------------------------------------------------
  const [memberCount, revenueCents] = await Promise.all([
    eligibleMemberCount(reportKey),
    monthlyEquivalentRevenueCents(reportKey),
  ]);

  const { count: newMembers } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .not("tier", "in", "(admin,speaker,sponsor)");

  // Sessions held this month (non-draft/cancelled/archived) + engagement.
  const { data: sessionRows } = await admin
    .from("sessions")
    .select("id, title, status, starts_at, program")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .in("status", ["scheduled", "live", "completed"])
    .order("starts_at");
  const sessions = sessionRows ?? [];
  const sessionIds = sessions.map((s) => s.id as string);
  const engagement = new Map<string, { enrolled: number; attended: number }>();
  if (sessionIds.length > 0) {
    const { data: enrollRows } = await admin
      .from("enrollments")
      .select("session_id, attended")
      .in("session_id", sessionIds.slice(0, 500));
    for (const e of enrollRows ?? []) {
      const cur = engagement.get(e.session_id as string) ?? {
        enrolled: 0,
        attended: 0,
      };
      cur.enrolled++;
      if (e.attended) cur.attended++;
      engagement.set(e.session_id as string, cur);
    }
  }

  // Speaker(s) of the month + their share.
  const { data: monthSpeakers } = await admin
    .from("speakers")
    .select("name, tsls_main_speaker")
    .eq("speaker_month", reportKey)
    .is("archived_at", null);

  const { count: emailFailures } = await admin
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .in("event", ["bounce", "blocked", "dropped", "spamreport"])
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString());

  // ---- Compose -------------------------------------------------------------
  const sessionLines =
    sessions.length === 0
      ? `<p style="margin:0 0 8px;">No sessions were held this month.</p>`
      : sessions
          .map((s) => {
            const e = engagement.get(s.id as string) ?? { enrolled: 0, attended: 0 };
            const rate =
              e.enrolled > 0 ? `${Math.round((e.attended / e.enrolled) * 100)}%` : "—";
            return `<p style="margin:0 0 6px;"><strong>${esc(s.title as string)}</strong> — ${e.enrolled} enrolled, ${e.attended} attended (${rate} engagement)</p>`;
          })
          .join("");

  const speakerLines = (monthSpeakers ?? [])
    .map((s) => {
      const share =
        !s.tsls_main_speaker && revenueCents !== null
          ? ` — 15% share: <strong>${formatCents(Math.round(revenueCents * SPEAKER_REVENUE_SHARE))}</strong>`
          : s.tsls_main_speaker
            ? " (TSLS Main Speaker — unpaid)"
            : "";
      return `<p style="margin:0 0 6px;">${esc(s.name as string)}${share}</p>`;
    })
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 14px;">Here's how Momentum+ did in <strong>${esc(label)}</strong>.</p>
    <p style="margin:0 0 6px;"><strong>${memberCount}</strong> members on the platform (excluding admins, speakers, and sponsors)</p>
    <p style="margin:0 0 6px;"><strong>${newMembers ?? 0}</strong> new memberships started</p>
    <p style="margin:0 0 14px;"><strong>${revenueCents === null ? "Billing not connected" : formatCents(revenueCents)}</strong> monthly-equivalent membership revenue (longer plans spread across the months they cover)</p>
    ${speakerLines ? `<p style="margin:0 0 6px;"><strong>Speaker of the month</strong></p>${speakerLines}` : ""}
    <p style="margin:14px 0 6px;"><strong>Sessions (${sessions.length})</strong></p>
    ${sessionLines}
    <p style="margin:14px 0 0;"><strong>${emailFailures ?? 0}</strong> email delivery failure${(emailFailures ?? 0) === 1 ? "" : "s"} recorded${(emailFailures ?? 0) > 0 ? " — details on the Email Delivery page" : ""}.</p>`;

  const { data: supers } = await admin
    .from("profiles")
    .select("id, email")
    .eq("admin_role", "super");

  if (supers?.length) {
    await admin.from("notifications").insert(
      supers.map((s) => ({
        profile_id: s.id,
        kind: "platform",
        title: `Monthly report: ${label}`,
        body: `${memberCount} members · ${revenueCents === null ? "revenue n/a" : formatCents(revenueCents)} · ${sessions.length} sessions`,
        link: "/admin",
      })),
    );
  }

  let emailed = 0;
  for (const s of supers ?? []) {
    if (!s.email) continue;
    const res = await sendEmailViaGhl({
      email: s.email as string,
      subject: `Momentum+ monthly report — ${label}`,
      html: brandedEmailHtml({
        greetingName: "",
        heading: `Monthly report — ${label}`,
        bodyHtml,
        ctaLabel: "Open the admin dashboard",
        ctaUrl: "/admin",
        footnote:
          "Sent to Super Admins on the 1st of each month, covering the month that just closed.",
      }),
    });
    if (res.sent) emailed++;
  }

  await admin.from("app_settings").upsert(
    {
      key: SENT_KEY,
      value: { month: reportKey, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return NextResponse.json({ ok: true, month: reportKey, emailed });
}
