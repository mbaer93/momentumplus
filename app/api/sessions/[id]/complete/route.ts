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
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, preview: true });
  }
  const session = await getSession(params.id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Enrolled members report ends — and so do the people most likely to be
  // alone in the room when it ends: the session's speaker and admins, who
  // join without enrolling. Without them, a host-only test meeting stayed
  // "live" until the hourly cron noticed.
  if (!session.isEnrolled) {
    let allowed = (await getCurrentMember())?.isAdmin ?? false;
    if (!allowed) {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (user) {
        allowed = (await speakerOwnsSession(user.id, session.id)).ok;
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not enrolled" }, { status: 403 });
    }
  }
  if (session.recurrence) {
    // Series sessions never auto-complete — next week's occurrence is next.
    return NextResponse.json({ ok: true, skipped: "recurring" });
  }
  if (new Date(session.startsAt).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, skipped: "not started" });
  }

  // VERIFY with Zoom before flipping: the client only knows a localized
  // disconnect reason, which also fires on plan cutoffs and host connection
  // blips. If Zoom says the meeting is still running, nothing completes.
  const service = createServiceClient();
  const { data: zoomRow } = await service
    .from("sessions")
    .select("zoom_meeting_id")
    .eq("id", session.id)
    .maybeSingle();
  if (zoomRow?.zoom_meeting_id) {
    try {
      const { getMeetingStatus } = await import("@/lib/zoom");
      const status = await getMeetingStatus(zoomRow.zoom_meeting_id as string);
      if (status === "started") {
        return NextResponse.json({ ok: true, skipped: "meeting still running" });
      }
    } catch {
      // Zoom unreachable — fall through to the time-based guard above.
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
