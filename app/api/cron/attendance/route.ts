import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMeetingParticipants, isZoomConfigured } from "@/lib/zoom";

/*
 * Attendance sync (SPEC.md §4). Vercel cron hits this after sessions end: for
 * each completed session with a Zoom meeting, pull the participant report and
 * mark matching enrollments attended=true by registrant email.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isZoomConfigured()) {
    return NextResponse.json({ error: "Zoom not configured" }, { status: 503 });
  }

  const admin = createServiceClient();

  // Sessions that have ended, have a Zoom meeting, and aren't archived yet.
  const cutoff = new Date().toISOString();
  const { data: sessions, error } = await admin
    .from("sessions")
    .select("id, zoom_meeting_id, starts_at, duration_min")
    .not("zoom_meeting_id", "is", null)
    .in("status", ["live", "completed"])
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
