import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { nextOccurrence, type Recurrence } from "@/lib/recurrence";
import { SPEAKER_FROM_SESSION } from "@/lib/session-speaker-embed";
import { isJoinWindowOpen } from "@/lib/sessions/view";
import { sponsorActive } from "@/lib/sponsor-lifecycle";
import { generateZoomSignature } from "@/lib/zoom-signature";
import { getZoomCreds } from "@/lib/service-config";
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
 *
 * Query budget (audit P2-17): this is the session-start burst path — every
 * enrolled member calls it in the same minute. It previously went through
 * getSession + speakerOwnsSession (~12 round-trips per call); now it's one
 * service-role session fetch (with the speaker embedded), one enrollment
 * check, and getCurrentMember for the admin/view-as decision.
 */
export async function POST(req: NextRequest) {
  let body: { sessionId?: string; asHost?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sessionId = body.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Preview mode has no Zoom creds either — same terminal state.
    return NextResponse.json(
      { error: "Live video isn't configured for this session yet." },
      { status: 503 },
    );
  }

  const admin = createServiceClient();
  const supabase = await createClient();
  const [userRes, sessionRes] = await Promise.all([
    supabase.auth.getUser(),
    admin
      .from("sessions")
      .select(
        `id, starts_at, duration_min, status, recurrence, recurrence_until, zoom_meeting_id, zoom_passcode, ${SPEAKER_FROM_SESSION} ( profile_id, archived_at, expires_at )`,
      )
      .eq("id", sessionId)
      .maybeSingle(),
  ]);
  const user = userRes.data.user;
  const row = sessionRes.data as {
    id: string;
    starts_at: string | null;
    duration_min: number | null;
    status: string;
    recurrence: string | null;
    recurrence_until: string | null;
    zoom_meeting_id: string | null;
    zoom_passcode: string | null;
    speakers: {
      profile_id: string | null;
      archived_at: string | null;
      expires_at: string | null;
    } | null;
  } | null;
  if (sessionRes.error || !row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // The session's own speaker hosts through the room under their own name
  // (same active-season rule as speakerOwnsSession); admins are backup
  // hosts. getCurrentMember keeps view-as honest — an admin previewing as
  // a member must behave like one.
  let isSpeakerHost = false;
  let isAdminViewer = false;
  let isEnrolled = false;
  if (user) {
    isSpeakerHost =
      row.speakers?.profile_id === user.id &&
      sponsorActive({
        archivedAt: row.speakers?.archived_at ?? null,
        expiresAt: row.speakers?.expires_at ?? null,
      });
    const [enrollRes, member] = await Promise.all([
      admin
        .from("enrollments")
        .select("session_id", { count: "exact", head: true })
        .eq("session_id", row.id)
        .eq("profile_id", user.id),
      getCurrentMember(),
    ]);
    isEnrolled = (enrollRes.count ?? 0) > 0;
    isAdminViewer = member?.isAdmin ?? false;
  }
  const hostEligible = isSpeakerHost || isAdminViewer;

  if (!isEnrolled && !hostEligible) {
    return NextResponse.json(
      { error: "You must be enrolled to join this session." },
      { status: 403 },
    );
  }

  // A recurring series joins at its current-or-next occurrence, matching
  // what the session page shows.
  const recurrence: Recurrence | null =
    row.recurrence === "weekly" ||
    row.recurrence === "biweekly" ||
    row.recurrence === "monthly" ||
    row.recurrence === "monthly_weekday"
      ? row.recurrence
      : null;
  const durationMin = row.duration_min ?? 60;
  let startsAt = row.starts_at ?? new Date().toISOString();
  if (recurrence && row.starts_at && row.status !== "cancelled") {
    const next = nextOccurrence(
      row.starts_at,
      durationMin,
      recurrence,
      row.recurrence_until ?? null,
    );
    if (next) startsAt = next;
  }

  if (!isJoinWindowOpen({ startsAt, durationMin })) {
    return NextResponse.json(
      { error: "The live room opens 30 minutes before the session starts." },
      { status: 403 },
    );
  }

  const zoom = await getZoomCreds();
  if (!zoom.sdkClientId || !zoom.sdkClientSecret || !row.zoom_meeting_id) {
    return NextResponse.json(
      { error: "Live video isn't configured for this session yet." },
      { status: 503 },
    );
  }

  // Who joins as host (role 1 + ZAK — starting from the Web SDK requires
  // both): the speaker always (they're the intended host); an admin ONLY
  // when they explicitly asked to host (asHost) — an admin-privileged
  // account merely opening the live page must join as a plain attendee,
  // otherwise their arrival silently starts the meeting as host. Even with
  // asHost, a started meeting stays hands-off so their join can't bump the
  // live host (all host joins share the account's Zoom user — see the
  // header comment).
  let hostJoin = isSpeakerHost;
  if (!hostJoin && isAdminViewer && body.asHost === true) {
    const { getMeetingStatus } = await import("@/lib/zoom");
    const status = await getMeetingStatus(row.zoom_meeting_id).catch(
      () => null,
    );
    // FAIL CLOSED: grant host only on Zoom's definitive "waiting" (not
    // started). null means the check errored — handing out a ZAK on an
    // unknown state could bump a live host off their own meeting.
    hostJoin = status === "waiting";
  }

  const signature = generateZoomSignature({
    sdkKey: zoom.sdkClientId,
    sdkSecret: zoom.sdkClientSecret,
    meetingNumber: row.zoom_meeting_id,
    role: hostJoin ? 1 : 0,
  });

  let zak: string | null = null;
  if (hostJoin) {
    const { getHostZak } = await import("@/lib/zoom");
    zak = await getHostZak();
  }

  return NextResponse.json(
    {
      signature,
      sdkKey: zoom.sdkClientId,
      meetingNumber: row.zoom_meeting_id,
      // Most Zoom accounts force meeting passcodes; the SDK join fails
      // without one. Only handed out after the checks above.
      passcode: row.zoom_passcode,
      zak,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
