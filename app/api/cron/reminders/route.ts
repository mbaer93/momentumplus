import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl, sendSmsViaGhl } from "@/lib/notifications";
import { sendPushToProfiles } from "@/lib/push";

/*
 * Session reminders (SPEC.md §4): cron runs every few minutes; any session
 * starting within the next 30 minutes triggers reminders to enrolled members
 * per their notification_prefs (session_reminder key). Idempotent: the
 * notifications table records one session_reminder per member+session.
 *
 * Built for a 350-enrollee session: the dedupe/prefs/contact lookups are
 * SET-BASED (three queries per session, not four per member), and the run
 * stops cleanly at a time budget — the every-few-minutes cadence drains the
 * remainder across the 30-minute window. The idempotency marker is written
 * AFTER that member's email/SMS attempt: a mid-run timeout used to mark
 * members "reminded" whose email never went out.
 */

export const maxDuration = 300;
const TIME_BUDGET_MS = 240_000; // leave headroom under maxDuration

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const runStart = Date.now();
  const windowEnd = new Date(runStart + 30 * 60 * 1000).toISOString();
  const nowIso = new Date(runStart).toISOString();

  const { data: sessions, error } = await admin
    .from("sessions")
    .select("id, title, starts_at")
    .eq("status", "scheduled")
    .gte("starts_at", nowIso)
    .lte("starts_at", windowEnd);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let notified = 0;
  let budgetExhausted = false;

  outer: for (const session of sessions ?? []) {
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("profile_id, profiles ( email, full_name, phone )")
      .eq("session_id", session.id);
    const members = (enrollments ?? []) as unknown as {
      profile_id: string;
      profiles: { email: string; full_name: string; phone: string | null } | null;
    }[];
    if (members.length === 0) continue;

    const link = `/sessions/${session.id}`;
    const ids = members.map((m) => m.profile_id);

    // Set-based lookups: dedupe markers, prefs, and GHL contact ids for the
    // whole roster at once.
    const [{ data: already }, { data: prefRows }, { data: contactRows }] =
      await Promise.all([
        admin
          .from("notifications")
          .select("profile_id")
          .eq("kind", "session_reminder")
          .eq("link", link)
          .in("profile_id", ids),
        admin
          .from("notification_prefs")
          .select("profile_id, email, sms, in_app")
          .eq("key", "session_reminder")
          .in("profile_id", ids),
        admin
          .from("memberships")
          .select("profile_id, ghl_contact_id")
          .in("profile_id", ids)
          .not("ghl_contact_id", "is", null),
      ]);
    const done = new Set((already ?? []).map((r) => r.profile_id as string));
    const prefBy = new Map(
      (prefRows ?? []).map((p) => [p.profile_id as string, p]),
    );
    const contactBy = new Map(
      (contactRows ?? []).map((c) => [
        c.profile_id as string,
        c.ghl_contact_id as string,
      ]),
    );

    const startLabel = session.starts_at
      ? new Date(session.starts_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        }) + " ET"
      : "soon";

    for (const member of members) {
      if (!member.profiles) continue;
      if (done.has(member.profile_id)) continue;
      if (Date.now() - runStart > TIME_BUDGET_MS) {
        budgetExhausted = true;
        break outer;
      }

      const pref = prefBy.get(member.profile_id);
      const wants = {
        email: pref?.email ?? true,
        sms: pref?.sms ?? false,
        in_app: pref?.in_app ?? true,
      };

      // Email/SMS FIRST, marker after — a timeout can at worst re-send one
      // member's reminder next tick, never silently skip them.
      if (wants.email) {
        await sendEmailViaGhl({
          contactId: contactBy.get(member.profile_id) ?? null,
          email: member.profiles.email,
          subject: `Starting soon: ${session.title}`,
          html: brandedEmailHtml({
            greetingName: member.profiles.full_name,
            heading: `Starting soon: ${session.title}`,
            bodyHtml: `<p style="margin:0 0 14px;"><strong>${session.title}</strong> begins at ${startLabel}. The live room opens 30 minutes before start.</p>`,
            ctaLabel: "Join the live room",
            ctaUrl: link,
            footnote:
              "You're receiving this because you're enrolled in this session. Manage reminders in your profile's notification preferences.",
          }),
        });
      }
      if (wants.sms && member.profiles.phone) {
        await sendSmsViaGhl({
          contactId: contactBy.get(member.profile_id) ?? null,
          email: member.profiles.email,
          phone: member.profiles.phone,
          message: `Momentum+: "${session.title}" starts at ${startLabel}. Join from your portal.`,
        });
      }

      // Push rides the in-app preference — it's the same alert on the
      // member's device. Best-effort; a push hiccup must not stall the run.
      if (wants.in_app) {
        try {
          await sendPushToProfiles([member.profile_id], {
            title: `Starting soon: ${session.title}`,
            body: `Begins at ${startLabel} — the live room is open now.`,
            link,
          });
        } catch {
          /* skip */
        }
      }

      // The notifications row doubles as the idempotency marker — ALWAYS
      // inserted (a member with in-app off but email on would otherwise be
      // re-sent every run). With in-app off it's born already-read.
      await admin.from("notifications").insert({
        profile_id: member.profile_id,
        kind: "session_reminder",
        title: `Starting soon: ${session.title}`,
        body: `Your session begins at ${startLabel}. The live room is open now.`,
        link,
        read_at: wants.in_app ? null : new Date().toISOString(),
      });
      notified++;
    }
  }

  return NextResponse.json({
    ok: true,
    sessionsInWindow: sessions?.length ?? 0,
    membersNotified: notified,
    budgetExhausted,
  });
}
