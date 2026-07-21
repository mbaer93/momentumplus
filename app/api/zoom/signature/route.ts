import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { getSession } from "@/lib/sessions/queries";
import { isJoinWindowOpen } from "@/lib/sessions/view";
import { generateZoomSignature } from "@/lib/zoom-signature";
import { getZoomCreds } from "@/lib/service-config";
import { speakerOwnsSession } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Issues a short-lived Zoom Meeting SDK join signature for the live room
 * (SPEC.md §4). Enforced server-side:
 *   - the caller must be enrolled in the session (the session's own speaker
 *     and admins may join without enrolling), and
 *   - the join window must be open (30 min before start → end).
 * HOST signatures (role 1 + ZAK): the session's SPEAKER always; ADMINS only
 * while the meeting hasn't started yet. Hosting through the room shows the
 * host's real name to attendees — the Zoom-app start URL can only ever show
 * the shared Zoom account's profile name. All host joins authenticate as the
 * shared account's Zoom user, so once someone is hosting, a second ZAK join
 * would bump them out mid-session — that's why a started meeting stops
 * handing admins host rights (the speaker keeps theirs to reclaim their own
 * dropped connection).
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

  // The session's own speaker hosts through the room under their own name;
  // admins are backup hosts.
  let isSpeakerHost = false;
  let isAdminViewer = false;
  if (isSupabaseConfigured()) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) {
      isSpeakerHost = (await speakerOwnsSession(user.id, session.id)).ok;
    }
    isAdminViewer = (await getCurrentMember())?.isAdmin ?? false;
  }
  const hostEligible = isSpeakerHost || isAdminViewer;

  // getSession resolves the viewer's enrollment via RLS-scoped queries.
  if (!session.isEnrolled && !hostEligible) {
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

  // Who joins as host (role 1 + ZAK — starting from the Web SDK requires
  // both): the speaker always; an admin only while the meeting hasn't
  // started, so their join can't bump a host who's already live (all host
  // joins share the account's Zoom user — see the header comment).
  let hostJoin = isSpeakerHost;
  if (!hostJoin && isAdminViewer) {
    const { getMeetingStatus } = await import("@/lib/zoom");
    const status = await getMeetingStatus(session.zoomMeetingId).catch(
      () => null,
    );
    hostJoin = status !== "started";
  }

  const signature = generateZoomSignature({
    sdkKey: zoom.sdkClientId,
    sdkSecret: zoom.sdkClientSecret,
    meetingNumber: session.zoomMeetingId,
    role: hostJoin ? 1 : 0,
  });

  let zak: string | null = null;
  if (hostJoin) {
    const { getHostZak } = await import("@/lib/zoom");
    zak = await getHostZak();
  }

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
      zak,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
