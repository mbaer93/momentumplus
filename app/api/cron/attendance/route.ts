import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMeetingParticipants } from "@/lib/zoom";
import { isZoomReady } from "@/lib/service-config";
import { nextOccurrence, type Recurrence } from "@/lib/recurrence";

/*
 * Session lifecycle + attendance sync (SPEC.md §4), on one cron:
 *
 * 1. Auto-advance status: scheduled → live while the session is running,
 *    live/scheduled → completed once it has ended. Recurring series instead
 *    cycle live → scheduled between occurrences and only complete once the
 *    whole series is past its end date. Nothing else does this,
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
  // Recurring (Rooted Focus) series must NOT be completed after one
  // occurrence — they cycle scheduled → live → scheduled until the series
  // end date passes. recurrence columns arrived in migration 0030, so fall
  // back to the legacy select if they're missing.
  type OpenRow = {
    id: string;
    status: string;
    starts_at: string;
    duration_min: number | null;
    recurrence?: Recurrence | null;
    recurrence_until?: string | null;
  };
  let openRes = await admin
    .from("sessions")
    .select("id, status, starts_at, duration_min, recurrence, recurrence_until")
    .in("status", ["scheduled", "live"])
    .not("starts_at", "is", null)
    .lte("starts_at", new Date(now).toISOString());
  if (openRes.error && /recurrence/.test(openRes.error.message)) {
    openRes = (await admin
      .from("sessions")
      .select("id, status, starts_at, duration_min")
      .in("status", ["scheduled", "live"])
      .not("starts_at", "is", null)
      .lte("starts_at", new Date(now).toISOString())) as typeof openRes;
  }
  const open = (openRes.data ?? []) as OpenRow[];

  // Self-heal: recurring rows someone (or a pre-fix cron) marked completed
  // while the series is still running go back to scheduled.
  const healRes = await admin
    .from("sessions")
    .select("id, starts_at, duration_min, recurrence, recurrence_until")
    .eq("status", "completed")
    .not("recurrence", "is", null);
  for (const s of (healRes.data ?? []) as OpenRow[]) {
    const occ = nextOccurrence(
      s.starts_at,
      s.duration_min ?? 60,
      s.recurrence as Recurrence,
      s.recurrence_until ?? null,
      now,
    );
    if (occ !== null) {
      open.push({ ...s, status: "completed" });
    }
  }

  let wentLive = 0;
  let wentCompleted = 0;
  let wentScheduled = 0;
  for (const s of open) {
    let next: string;
    if (s.recurrence) {
      const occ = nextOccurrence(
        s.starts_at,
        s.duration_min ?? 60,
        s.recurrence,
        s.recurrence_until ?? null,
        now,
      );
      if (occ === null) {
        next = "completed"; // series fully ended
      } else {
        const occStart = new Date(occ).getTime();
        const occEnd = occStart + (s.duration_min ?? 60) * 60 * 1000;
        next = now >= occStart && now < occEnd ? "live" : "scheduled";
      }
    } else {
      const started = new Date(s.starts_at).getTime();
      const endMs = started + (s.duration_min ?? 60) * 60 * 1000;
      next = now >= endMs ? "completed" : "live";
    }
    if (next === s.status) continue;
    const { error: transitionError } = await admin
      .from("sessions")
      .update({ status: next })
      .eq("id", s.id)
      .eq("status", s.status); // no-op if an admin changed it mid-run
    if (!transitionError) {
      if (next === "live") wentLive += 1;
      else if (next === "completed") wentCompleted += 1;
      else wentScheduled += 1;
    }
  }

  if (!(await isZoomReady())) {
    return NextResponse.json({
      ok: true,
      wentLive,
      wentCompleted,
      wentScheduled,
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

    const present = participants.filter((p) => p.duration > 0);
    const attendedEmails = new Set(
      present
        // Lowercase to match the enrollment side (also lowercased below) —
        // Zoom returns mixed-case emails and a case mismatch left real
        // attendees marked absent.
        .map((p) => (p.email ?? "").toLowerCase())
        .filter(Boolean),
    );
    // Zoom's report often has NO email for guests — which is exactly how
    // members join the embedded room. Fall back to the display name, which
    // the portal sets to the member's profile name on join.
    const attendedNames = new Set(
      present.map((p) => (p.name ?? "").trim().toLowerCase()).filter(Boolean),
    );
    if (attendedEmails.size === 0 && attendedNames.size === 0) continue;

    // Match participants to enrollments by email first, then by name.
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, profile_id, profiles ( email, full_name )")
      .eq("session_id", session.id)
      .eq("attended", false);

    const toMark: string[] = [];
    for (const e of enrollments ?? []) {
      const p = (
        e as unknown as {
          profiles: { email: string; full_name: string | null } | null;
        }
      ).profiles;
      const email = p?.email?.toLowerCase();
      const name = p?.full_name?.trim().toLowerCase();
      if (
        (email && attendedEmails.has(email)) ||
        (name && attendedNames.has(name))
      ) {
        toMark.push(e.id);
      }
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

  return NextResponse.json({
    ok: true,
    wentLive,
    wentCompleted,
    wentScheduled,
    updated,
    sessions: results,
  });
}
