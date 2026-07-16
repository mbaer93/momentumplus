import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMeetingParticipants } from "@/lib/zoom";
import { isZoomReady } from "@/lib/service-config";

/*
 * Session lifecycle + attendance sync (SPEC.md §4), on one cron:
 *
 * 1. Auto-advance status: scheduled → live while the session is running,
 *    live/scheduled → completed once it has ended. Nothing else does this,
 *    and downstream features hang off it — the AI-summaries cron only
 *    processes completed sessions, enrollment RLS only allows scheduled
 *    sessions, and the attendance pull below only looks at ended sessions.
 * 2. For recently-ended sessions with a Zoom meeting, pull the participant
 *    report and mark matching enrollments attended=true by email.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
 */

/** Sessions are swept for attendance for this long after they end. */
const ATTENDANCE_WINDOW_DAYS = 3;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const now = Date.now();

  // --- 1. Status transitions (runs even when Zoom isn't configured) ---
  const { data: open } = await admin
    .from("sessions")
    .select("id, status, starts_at, duration_min")
    .in("status", ["scheduled", "live"])
    .not("starts_at", "is", null)
    .lte("starts_at", new Date(now).toISOString());

  let wentLive = 0;
  let wentCompleted = 0;
  for (const s of open ?? []) {
    const started = new Date(s.starts_at as string).getTime();
    const endMs = started + (s.duration_min ?? 60) * 60 * 1000;
    const next = now >= endMs ? "completed" : "live";
    if (next === s.status) continue;
    const { error: transitionError } = await admin
      .from("sessions")
      .update({ status: next })
      .eq("id", s.id)
      .eq("status", s.status); // no-op if an admin changed it mid-run
    if (!transitionError) {
      if (next === "live") wentLive += 1;
      else wentCompleted += 1;
    }
  }

  if (!(await isZoomReady())) {
    return NextResponse.json({
      ok: true,
      wentLive,
      wentCompleted,
      attendance: "skipped (Zoom not configured)",
    });
  }

  // --- 2. Attendance for sessions that ended recently ---
  // Bounded window: Zoom reports stabilize within hours; re-pulling every
  // historical session forever would burn the Zoom API rate limit.
  const cutoff = new Date(now).toISOString();
  const windowStart = new Date(
    now - ATTENDANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: sessions, error } = await admin
    .from("sessions")
    .select("id, zoom_meeting_id, starts_at, duration_min")
    .not("zoom_meeting_id", "is", null)
    .in("status", ["live", "completed"])
    .gte("starts_at", windowStart)
    .lte("starts_at", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let updated = 0;
  const results: { sessionId: string; matched: number }[] = [];

  for (const session of sessions ?? []) {
    if (!session.zoom_meeting_id) continue;

    let participants;
    try {
      participants = await getMeetingParticipants(session.zoom_meeting_id);
    } catch {
      continue; // report may not be ready yet; try again next run
    }

    const attendedEmails = new Set(
      participants.filter((p) => p.duration > 0).map((p) => p.email),
    );
    if (attendedEmails.size === 0) continue;

    // Match participants to enrollments by the member's email.
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, profile_id, profiles ( email )")
      .eq("session_id", session.id)
      .eq("attended", false);

    const toMark: string[] = [];
    for (const e of enrollments ?? []) {
      const email = (
        e as unknown as { profiles: { email: string } | null }
      ).profiles?.email?.toLowerCase();
      if (email && attendedEmails.has(email)) toMark.push(e.id);
    }

    if (toMark.length > 0) {
      const { error: markError } = await admin
        .from("enrollments")
        .update({ attended: true, attended_source: "zoom" })
        .in("id", toMark);
      if (!markError) updated += toMark.length;
    }
    results.push({ sessionId: session.id, matched: toMark.length });
  }

  return NextResponse.json({ ok: true, updated, sessions: results });
}
