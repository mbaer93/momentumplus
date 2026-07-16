import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/sessions/queries";
import { isJoinWindowOpen } from "@/lib/sessions/view";
import { generateZoomSignature } from "@/lib/zoom-signature";
import { getZoomCreds } from "@/lib/service-config";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Issues a short-lived Zoom Meeting SDK join signature for the embedded live
 * room (SPEC.md §4). Enforced server-side:
 *   - the caller must be enrolled in the session, and
 *   - the join window must be open (30 min before start → end).
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

  // getSession resolves the viewer's enrollment via RLS-scoped queries.
  if (!session.isEnrolled) {
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
    role: 0, // attendee
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
