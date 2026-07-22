/*
 * Shared plumbing for email-provider event webhooks (SendGrid, Resend):
 * journal normalized events into email_events (migration 0050) and alert
 * Super Admins about delivery failures — bell first, then a GHL email (a
 * different pipe than the failing one, so the alert itself can't be
 * swallowed by the same outage).
 */

import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/admin";

/** Normalized event names shared by all providers + the admin UI. */
export type NormalizedEmailEvent =
  | "delivered"
  | "open"
  | "bounce"
  | "blocked"
  | "dropped"
  | "spamreport";

export const FAILURE_EVENTS = new Set<NormalizedEmailEvent>([
  "bounce",
  "blocked",
  "dropped",
  "spamreport",
]);

export interface EmailEventRow {
  email: string;
  event: NormalizedEmailEvent;
  reason: string | null;
  occurred_at: string;
}

const RETENTION_DAYS = 90;
// One webhook POST can carry many events (bulk invite to a bad list) —
// list this many in the alert, summarize the rest.
const MAX_LISTED = 20;

/** Best-effort journal — pre-migration-0050 the insert fails quietly. */
export async function journalEmailEvents(rows: EmailEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const admin = createServiceClient();
  await admin.from("email_events").insert(rows.slice(0, 500));
  // Opportunistic retention sweep — indexed, cheap, keeps the table lean.
  await admin
    .from("email_events")
    .delete()
    .lt(
      "occurred_at",
      new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
}

/** Alert every Super Admin about delivery failures. */
export async function alertEmailFailures(
  failures: { email: string; event: string; reason: string }[],
  provider: { name: string; activityUrl: string; suppressionNote: string },
): Promise<number> {
  if (failures.length === 0) return 0;
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
      ? `<p style="margin:0 0 8px;">…and ${failures.length - MAX_LISTED} more (see ${esc(provider.name)}'s activity feed).</p>`
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
        link: "/admin/email-activity",
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
          <p style="margin:0 0 12px;">${esc(provider.name)} couldn't deliver account email (invite, password reset, or login link) to:</p>
          ${lines}${more}
          <p style="margin:12px 0 0;">${provider.suppressionNote}</p>`,
        ctaLabel: `Open ${provider.name} activity`,
        ctaUrl: provider.activityUrl,
        footnote: `Sent because ${provider.name} reported a delivery failure. This alert travels via GHL, so it arrives even when the auth-email provider is the problem.`,
      }),
    });
    if (res.sent) emailed++;
  }
  return emailed;
}
