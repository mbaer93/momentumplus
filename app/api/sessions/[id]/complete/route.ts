import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/sessions/queries";
import { createServiceClient } from "@/lib/supabase/admin";
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
  if (!session.isEnrolled) {
    return NextResponse.json({ error: "Not enrolled" }, { status: 403 });
  }
  if (session.recurrence) {
    // Series sessions never auto-complete — next week's occurrence is next.
    return NextResponse.json({ ok: true, skipped: "recurring" });
  }
  if (new Date(session.startsAt).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, skipped: "not started" });
  }

  const { error } = await createServiceClient()
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
