import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/sessions/queries";
import { isJoinWindowOpen } from "@/lib/sessions/view";
import { generateZoomSignature } from "@/lib/zoom-signature";
import { getZoomCreds } from "@/lib/service-config";
import { speakerOwnsSession } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Issues a short-lived Zoom Meeting SDK join signature for the embedded live
 * room (SPEC.md §4). Enforced server-side:
 *   - the caller must be enrolled in the session (the session's own speaker
 *     may join without enrolling), and
 *   - the join window must be open (30 min before start → end).
 * The session's SPEAKER gets a HOST signature (role 1): hosting through the
 * embedded room shows their real name to attendees — the Zoom-app start URL
 * can only ever show the shared Zoom account's profile name.
 * The SDK secret never leaves the server.
 */
export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sessionId = body.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // The session's own speaker hosts through the embed under their own name.
  let isSpeakerHost = false;
  if (isSupabaseConfigured()) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) {
      isSpeakerHost = (await speakerOwnsSession(user.id, session.id)).ok;
    }
  }

  // getSession resolves the viewer's enrollment via RLS-scoped queries.
  if (!session.isEnrolled && !isSpeakerHost) {
    return NextResponse.json(
      { error: "You must be enrolled to join this session." },
      { status: 403 },
    );
  }

  if (!isJoinWindowOpen(session)) {
    return NextResponse.json(
      { error: "The live room opens 30 minutes before the session starts." },
      { status: 403 },
    );
  }

  const zoom = await getZoomCreds();
  if (!zoom.sdkClientId || !zoom.sdkClientSecret || !session.zoomMeetingId) {
    return NextResponse.json(
      { error: "Live video isn't configured for this session yet." },
      { status: 503 },
    );
  }

  const signature = generateZoomSignature({
    sdkKey: zoom.sdkClientId,
    sdkSecret: zoom.sdkClientSecret,
    meetingNumber: session.zoomMeetingId,
    // Host for the session's speaker (their join starts the meeting and
    // displays THEIR name); attendee for everyone else.
    role: isSpeakerHost ? 1 : 0,
  });

  // Most Zoom accounts force meeting passcodes; the SDK join fails without
  // one. Only handed out here — after the enrollment + join-window checks.
  let passcode: string | null = null;
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("sessions")
      .select("zoom_passcode")
      .eq("id", session.id)
      .maybeSingle();
    passcode = (data?.zoom_passcode as string | null) ?? null;
  }

  return NextResponse.json(
    {
      signature,
      sdkKey: zoom.sdkClientId,
      meetingNumber: session.zoomMeetingId,
      passcode,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
