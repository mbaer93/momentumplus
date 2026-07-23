import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMeetingParticipants, getMeetingRecordings } from "@/lib/zoom";
import { ingestSessionRecording, type IngestSession } from "@/lib/zoom-recordings";
import { isZoomReady } from "@/lib/service-config";
import {
  lastOccurrenceStart,
  nextOccurrence,
  type Recurrence,
} from "@/lib/recurrence";

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

/** One-off sessions aren't auto-completed until this long past their
    scheduled end — sessions run long, and completing mid-meeting closes
    enrollment and marks the session "past" while people are still in the
    room. Mirrors the live room's join-window overrun. The /complete
    endpoint (Zoom-verified) still flips them the moment the host actually
    ends; this cron is the backstop. */
const COMPLETE_GRACE_MS = 60 * 60 * 1000;

// Long-running under load — allow the full function window (Vercel Pro).
export const maxDuration = 300;

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
      next = now >= endMs + COMPLETE_GRACE_MS ? "completed" : "live";
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
  interface SweepRow {
    id: string;
    zoom_meeting_id: string | null;
    starts_at: string;
    duration_min: number | null;
    status?: string;
  }
  // One-off sessions: windowed on starts_at. "cancelled" is included so a
  // session cancelled AFTER it ran still gets its recording imported (the
  // ended-guard deliberately preserves its Zoom meeting for exactly this).
  let sessionsRes = await admin
    .from("sessions")
    .select("id, zoom_meeting_id, starts_at, duration_min, status")
    .not("zoom_meeting_id", "is", null)
    .is("recurrence", null)
    .in("status", ["live", "completed", "cancelled"])
    .gte("starts_at", windowStart)
    .lte("starts_at", cutoff);
  if (sessionsRes.error && /recurrence/.test(sessionsRes.error.message)) {
    // Pre-migration-0030 fallback: no recurrence column, original shape.
    sessionsRes = await admin
      .from("sessions")
      .select("id, zoom_meeting_id, starts_at, duration_min, status")
      .not("zoom_meeting_id", "is", null)
      .in("status", ["live", "completed", "cancelled"])
      .gte("starts_at", windowStart)
      .lte("starts_at", cutoff);
  }
  if (sessionsRes.error) {
    return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });
  }
  const sessions: SweepRow[] = (sessionsRes.data ?? []) as SweepRow[];

  // Recurring series: their static starts_at leaves the window after the
  // first occurrence, which silently ended attendance for every later one.
  // Window them on the CURRENT occurrence instead.
  const { data: recurringRows } = await admin
    .from("sessions")
    .select(
      "id, zoom_meeting_id, starts_at, duration_min, status, recurrence, recurrence_until",
    )
    .not("zoom_meeting_id", "is", null)
    .not("recurrence", "is", null)
    .in("status", ["scheduled", "live"]);
  for (const r of (recurringRows ?? []) as (SweepRow & {
    recurrence: Recurrence;
    recurrence_until: string | null;
  })[]) {
    const occ = lastOccurrenceStart(
      r.starts_at,
      r.recurrence,
      r.recurrence_until,
      now,
    );
    if (occ && occ >= windowStart && occ <= cutoff) {
      sessions.push({ ...r, starts_at: occ });
    }
  }

  let updated = 0;
  const results: { sessionId: string; matched: number }[] = [];

  for (const session of sessions) {
    if (!session.zoom_meeting_id) continue;
    // Cancelled sessions are in the sweep only for RECORDING import —
    // marking attendance on a cancelled session would be wrong data.
    if (session.status === "cancelled") continue;

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

    // Name matches are a fallback (Zoom often omits guest emails) and only
    // count when the name is UNIQUE among this session's enrollments — with
    // two enrolled "John Smith"s, one attending would mark both present.
    const nameCounts = new Map<string, number>();
    for (const e of enrollments ?? []) {
      const n = (
        e as unknown as { profiles: { full_name: string | null } | null }
      ).profiles?.full_name
        ?.trim()
        .toLowerCase();
      if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }

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
        (name && attendedNames.has(name) && nameCounts.get(name) === 1)
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

  // --- 3. Recording import fallback ---
  // The Zoom webhook delivers recordings instantly when configured in the
  // Zoom dashboard — but that setup step is easy to miss, and without it
  // recordings never reached the Library. This poller asks the Zoom API
  // directly for recently-ended sessions that have no Library video yet,
  // so the pipeline works with NO Zoom dashboard configuration at all.
  const recordings: { sessionId: string; status: string }[] = [];
  const endedAwhileAgo = sessions.filter((s) => {
    const end =
      new Date(s.starts_at as string).getTime() +
      ((s.duration_min as number | null) ?? 60) * 60000;
    // Give Zoom time to finish processing the cloud recording.
    return now - end > 15 * 60 * 1000;
  });
  if (endedAwhileAgo.length > 0) {
    const { data: vids } = await admin
      .from("videos")
      .select("session_id")
      .in(
        "session_id",
        endedAwhileAgo.map((s) => s.id as string),
      );
    const have = new Set((vids ?? []).map((v) => v.session_id as string));
    // Bounded per run — the window re-checks stragglers on later passes.
    const targets = endedAwhileAgo.filter((s) => !have.has(s.id as string)).slice(0, 5);
    for (const s of targets) {
      try {
        const rec = await getMeetingRecordings(s.zoom_meeting_id as string);
        if (!rec) {
          recordings.push({ sessionId: s.id as string, status: "no recording available yet" });
          continue;
        }
        const { data: full } = await admin
          .from("sessions")
          .select("id, title, category, min_access, program")
          .eq("id", s.id)
          .maybeSingle();
        if (!full) continue;
        const result = await ingestSessionRecording(
          admin,
          full as unknown as IngestSession,
          rec.files,
          rec.accessToken,
        );
        recordings.push({ sessionId: s.id as string, status: result.status });
      } catch (e) {
        recordings.push({
          sessionId: s.id as string,
          status: `error: ${(e as Error).message}`,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    wentLive,
    wentCompleted,
    wentScheduled,
    updated,
    sessions: results,
    recordings,
  });
}
