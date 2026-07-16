import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { createZoomMeeting } from "@/lib/zoom";
import { isZoomReady } from "@/lib/service-config";

/*
 * Admin: publish a session. Creates the Zoom meeting (if not already created),
 * stores the meeting id + join URL, and moves the session to `scheduled`.
 * SPEC.md §4: "Admin creates session → API creates Zoom meeting, stores join URL."
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin("sessions");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const admin = createServiceClient();

  const { data: session, error } = await admin
    .from("sessions")
    .select(
      "id, title, description, starts_at, duration_min, zoom_meeting_id, status",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!session.starts_at) {
    return NextResponse.json(
      { error: "Set a start time before publishing." },
      { status: 400 },
    );
  }

  // Publishing a draft schedules it; re-publishing a live/completed/archived
  // session must NOT drag it back to "scheduled" (that hides its AI summary
  // and re-arms reminders). Re-publish still backfills a missing Zoom meeting.
  let update: Record<string, unknown> =
    session.status === "draft" ? { status: "scheduled" } : {};

  // Create the Zoom meeting only once, and only if Zoom is configured.
  if (!session.zoom_meeting_id && (await isZoomReady())) {
    try {
      const meeting = await createZoomMeeting({
        topic: session.title,
        startTime: session.starts_at,
        durationMin: session.duration_min ?? 60,
        agenda: session.description ?? undefined,
      });
      update = {
        ...update,
        zoom_meeting_id: meeting.id,
        zoom_join_url: meeting.joinUrl,
        // The SDK join needs the passcode explicitly; the join URL embeds it.
        zoom_passcode: meeting.password ?? null,
      };
    } catch (e) {
      return NextResponse.json(
        { error: `Zoom meeting creation failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { error: updateError } = await admin
    .from("sessions")
    .update(update)
    .eq("id", session.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...update });
}
