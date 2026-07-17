import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireAdmin } from "@/lib/auth-helpers";
import { speakerOwnsSession } from "@/lib/speaker-tools";
import { getMeetingStartUrl } from "@/lib/zoom";

/*
 * Host-start for a session's Zoom meeting. Only the session's own speaker
 * (or an admin) ever receives the start URL — it grants host powers. The
 * URL is fetched live from Zoom, never stored or exposed to members.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { origin } = new URL(request.url);
  const back = (msg: string) =>
    NextResponse.redirect(`${origin}/speaker?error=${encodeURIComponent(msg)}`);

  if (!isSupabaseConfigured()) return back("Preview mode — no live Zoom.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?redirect=${encodeURIComponent(`/api/sessions/${params.id}/start`)}`,
    );
  }

  const owns = await speakerOwnsSession(user.id, params.id);
  if (!owns.ok) {
    const admin = await requireAdmin("sessions");
    if (!admin.ok) return back("Only the session's speaker can start it.");
  }

  const { data: session } = await createServiceClient()
    .from("sessions")
    .select("zoom_meeting_id")
    .eq("id", params.id)
    .maybeSingle();
  const meetingId = session?.zoom_meeting_id as string | null;
  if (!meetingId) {
    return back("This session doesn't have a Zoom meeting yet — ask the team to publish it.");
  }

  try {
    const startUrl = await getMeetingStartUrl(meetingId);
    if (!startUrl) return back("Zoom didn't return a start link — try again in a moment.");
    return NextResponse.redirect(startUrl);
  } catch {
    return back("Couldn't reach Zoom — try again in a moment.");
  }
}
