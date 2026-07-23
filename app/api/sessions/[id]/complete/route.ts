import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { getSession } from "@/lib/sessions/queries";
import { speakerOwnsSession } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Called by the embedded live room when the HOST ends the meeting for
 * everyone — the platform then agrees with what just happened in the room:
 * the session flips to "completed" instead of sitting "live"/"scheduled".
 *
 * Guards: the caller must be an enrolled member of the session (getSession
 * resolves enrollment through RLS), the session must actually be underway
 * (start time in the past), and only scheduled/live one-off sessions flip —
 * a recurring series keeps rolling to its next occurrence.
 */
// Room for the end-record retries below.
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, preview: true });
  }
  // force: the host just ended the meeting and says so — skip the Zoom
  // verification below (whose record can lag) and complete right now.
  // Hosts only; a member can never force a session closed.
  let force = false;
  try {
    force = ((await req.json()) as { force?: boolean })?.force === true;
  } catch {
    /* no body — the normal disconnect ping */
  }
  const session = await getSession(params.id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Enrolled members report ends — and so do the people most likely to be
  // alone in the room when it ends: the session's speaker and admins, who
  // join without enrolling. Without them, a host-only test meeting stayed
  // "live" until the hourly cron noticed.
  if (!session.isEnrolled || force) {
    let privileged = (await getCurrentMember())?.isAdmin ?? false;
    if (!privileged) {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (user) {
        privileged = (await speakerOwnsSession(user.id, session.id)).ok;
      }
    }
    if (!privileged) {
      return NextResponse.json(
        { error: session.isEnrolled ? "Hosts only" : "Not enrolled" },
        { status: 403 },
      );
    }
  }
  if (session.recurrence) {
    // Series sessions never auto-complete — next week's occurrence is next.
    return NextResponse.json({ ok: true, skipped: "recurring" });
  }
  if (new Date(session.startsAt).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, skipped: "not started" });
  }

  // VERIFY with Zoom before flipping, and FAIL CLOSED. Two traps here:
  // (1) the live meeting status reads "waiting" both when the meeting has
  // ended AND when a late host simply hasn't started it yet — completing on
  // "not started" would close enrollment and mark the session past while
  // members sit waiting for the host; (2) a Zoom API blip must not complete
  // anything. So: skip while running, and otherwise require Zoom's
  // past-meeting record to show a real end AT THIS session's occurrence —
  // no confirmation, no completion (the hourly cron is the backstop).
  const service = createServiceClient();
  const { data: zoomRow } = await service
    .from("sessions")
    .select("zoom_meeting_id")
    .eq("id", session.id)
    .maybeSingle();
  if (zoomRow?.zoom_meeting_id && !force) {
    const { getMeetingStatus, getPastMeetingEnd } = await import("@/lib/zoom");
    const status = await getMeetingStatus(zoomRow.zoom_meeting_id as string);
    if (status === "started") {
      return NextResponse.json({ ok: true, skipped: "meeting still running" });
    }
    // Zoom writes the past-meeting record a few SECONDS after "end for
    // all" — an immediate ask often misses it, which left just-ended
    // sessions sitting "live". Retry briefly before giving up.
    let endedAt = await getPastMeetingEnd(zoomRow.zoom_meeting_id as string);
    for (let i = 0; i < 4 && !endedAt; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      endedAt = await getPastMeetingEnd(zoomRow.zoom_meeting_id as string);
    }
    // 15-min slack: a host may start a touch early; anything older is a
    // previous run (a test days before) and doesn't count for this one.
    const occurrenceStart =
      new Date(session.startsAt).getTime() - 15 * 60 * 1000;
    if (!endedAt || new Date(endedAt).getTime() < occurrenceStart) {
      return NextResponse.json({
        ok: true,
        skipped: "meeting has not ended (or Zoom unreachable)",
      });
    }
  }

  const { error } = await service
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", session.id)
    .in("status", ["scheduled", "live"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  revalidatePath("/sessions");
  revalidatePath(`/sessions/${session.id}`);
  revalidatePath("/admin/sessions");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true });
}
