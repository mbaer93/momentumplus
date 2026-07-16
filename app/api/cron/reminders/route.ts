import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl, sendSmsViaGhl } from "@/lib/notifications";

/*
 * Session reminders (SPEC.md §4): cron runs every few minutes; any session
 * starting within the next 30 minutes triggers reminders to enrolled members
 * per their notification_prefs (session_reminder key). In-app rows are always
 * the source of truth; email/SMS go through GHL when configured. Idempotent:
 * the notifications table records one session_reminder per member+session.
 */
export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const now = Date.now();
  const windowEnd = new Date(now + 30 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

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
  for (const session of sessions ?? []) {
    const { data: enrollments } = await admin
      .from("enrollments")
      .select(
        "profile_id, profiles ( email, full_name, phone )",
      )
      .eq("session_id", session.id);

    for (const e of enrollments ?? []) {
      const profile = (
        e as unknown as {
          profile_id: string;
          profiles: { email: string; full_name: string; phone: string | null } | null;
        }
      );
      if (!profile.profiles) continue;

      // Idempotency: one reminder per member per session.
      const link = `/sessions/${session.id}`;
      const { data: existing } = await admin
        .from("notifications")
        .select("id")
        .eq("profile_id", profile.profile_id)
        .eq("kind", "session_reminder")
        .eq("link", link)
        .maybeSingle();
      if (existing) continue;

      // Respect prefs (default: email + in-app on, SMS off).
      const { data: pref } = await admin
        .from("notification_prefs")
        .select("email, sms, in_app")
        .eq("profile_id", profile.profile_id)
        .eq("key", "session_reminder")
        .maybeSingle();
      const wants = {
        email: pref?.email ?? true,
        sms: pref?.sms ?? false,
        in_app: pref?.in_app ?? true,
      };

      const startLabel = session.starts_at
        ? new Date(session.starts_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          }) + " ET"
        : "soon";

      // The notifications row doubles as the idempotency marker checked
      // above, so it is ALWAYS inserted — a member with in-app off but
      // email/SMS on would otherwise be re-sent every cron run inside the
      // reminder window. When in-app is off, the row is born already-read
      // so it never surfaces as an unread notification.
      await admin.from("notifications").insert({
        profile_id: profile.profile_id,
        kind: "session_reminder",
        title: `Starting soon: ${session.title}`,
        body: `Your session begins at ${startLabel}. The live room is open now.`,
        link,
        read_at: wants.in_app ? null : new Date().toISOString(),
      });

      // GHL contact id lives on the membership row.
      const { data: membership } = await admin
        .from("memberships")
        .select("ghl_contact_id")
        .eq("profile_id", profile.profile_id)
        .not("ghl_contact_id", "is", null)
        .limit(1)
        .maybeSingle();

      if (wants.email) {
        await sendEmailViaGhl({
          contactId: membership?.ghl_contact_id,
          email: profile.profiles.email,
          subject: `Starting soon: ${session.title}`,
          html: `<p>Hi ${profile.profiles.full_name || "there"},</p><p><strong>${session.title}</strong> begins at ${startLabel}. Join from your Momentum+ portal — the live room is open 30 minutes before start.</p>`,
        });
      }
      if (wants.sms && profile.profiles.phone) {
        await sendSmsViaGhl({
          contactId: membership?.ghl_contact_id,
          phone: profile.profiles.phone,
          message: `Momentum+: "${session.title}" starts at ${startLabel}. Join from your portal.`,
        });
      }
      notified++;
    }
  }

  return NextResponse.json({
    ok: true,
    sessionsInWindow: sessions?.length ?? 0,
    membersNotified: notified,
  });
}
