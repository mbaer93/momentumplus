import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AccessLevel, SessionCategory, SessionDetail } from "@/lib/types";
import { getPlaceholderSession, getPlaceholderSessions } from "./data";
import { nextOccurrence } from "@/lib/recurrence";
import { requestCache } from "@/lib/request-cache";
import { speakerLive } from "@/lib/sponsor-lifecycle";

/*
 * Sessions data access. When Supabase is configured, reads from the database
 * (RLS already restricts rows to what the viewer may see). In Phase 1/2 preview
 * mode (no Supabase env) it returns the placeholder dataset so the UI renders.
 */

function initialsFrom(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Minimal shape of the joined row we select from Supabase.
interface SessionRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  starts_at: string | null;
  duration_min: number | null;
  capacity: number | null;
  min_access: AccessLevel;
  status: SessionDetail["status"];
  speakers: {
    id: string;
    name: string;
    title: string | null;
    archived_at?: string | null;
    expires_at?: string | null;
  } | null;
  program?: string | null;
  recurrence?: string | null;
  recurrence_until?: string | null;
  host_name?: string | null;
}

function mapRow(row: SessionRow): SessionDetail {
  // Pre-season and archived speakers are hidden platform-wide (directory,
  // community, Q&A) — their names must not leak through session cards
  // either. Until they're live, the session shows TBA.
  const spk =
    row.speakers &&
    speakerLive({
      archivedAt: row.speakers.archived_at ?? null,
      expiresAt: row.speakers.expires_at ?? null,
    })
      ? row.speakers
      : null;
  // Rooted Focus sessions are led by an SLC team member who may not be a
  // speaker — the host name fills the speaker slot for display.
  const speakerName = spk?.name ?? row.host_name ?? "TBA";
  const recurrence =
    row.recurrence === "weekly" ||
    row.recurrence === "biweekly" ||
    row.recurrence === "monthly"
      ? row.recurrence
      : null;
  const session: SessionDetail = {
    id: row.id,
    slug: row.id,
    title: row.title,
    description: row.description ?? "",
    category: (row.category as SessionCategory) ?? "Leadership",
    objectives: [],
    speaker: {
      id: spk?.id ?? "tba",
      name: speakerName,
      title: spk?.title ?? (row.host_name && !spk ? "SLC Team" : ""),
      initials: initialsFrom(speakerName),
      avatarBg: "#1C3050",
      avatarColor: "#D4AE75",
    },
    startsAt: row.starts_at ?? new Date().toISOString(),
    durationMin: row.duration_min ?? 60,
    capacity: row.capacity,
    enrolledCount: 0,
    minAccess: row.min_access,
    status: row.status,
    program: row.program === "rooted_focus" ? "rooted_focus" : "standard",
    recurrence,
    recurrenceUntil: row.recurrence_until ?? null,
    hostName: row.host_name ?? null,
    // Filled by getSession via the service role for enrolled viewers only.
    zoomJoinUrl: null,
    zoomMeetingId: null,
    resources: [],
    aiSummary: null,
    isEnrolled: false,
    attended: false,
    note: "",
  };
  // A recurring series presents as its current-or-next occurrence, so cards,
  // join windows, and "Add to calendar" all track the series week to week.
  if (recurrence && row.starts_at && session.status !== "cancelled") {
    const next = nextOccurrence(
      row.starts_at,
      session.durationMin,
      recurrence,
      session.recurrenceUntil,
    );
    if (next) session.startsAt = next;
  }
  return session;
}

// Join credentials (zoom_join_url / zoom_meeting_id / zoom_passcode) are
// intentionally NOT selectable by members — column grants in migration 0020
// hide them, and getSession attaches them via the service role only after
// confirming the viewer is enrolled.
const SESSION_SELECT =
  "id, title, description, category, starts_at, duration_min, capacity, min_access, status, program, recurrence, recurrence_until, host_name, speakers ( id, name, title, archived_at, expires_at )";
// Pre-migration fallback (before 0030 adds the Rooted Focus columns).
const SESSION_SELECT_LEGACY =
  "id, title, description, category, starts_at, duration_min, capacity, min_access, status, speakers ( id, name, title )";

/* requestCache(): layout + page both call this — one execution per request. */
export const listSessions = requestCache(async (): Promise<SessionDetail[]> => {
  if (!isSupabaseConfigured()) return getPlaceholderSessions();

  const supabase = createClient();
  let res = await supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .order("starts_at", { ascending: true });
  if (res.error && /program|recurrence|host_name/.test(res.error.message)) {
    // Pre-migration fallback: the columns arrive with migration 0030.
    res = (await supabase
      .from("sessions")
      .select(SESSION_SELECT_LEGACY)
      .order("starts_at", { ascending: true })) as typeof res;
  }
  const { data, error } = res;

  // Configured mode never shows demo fixtures. A FAILED query is not an
  // empty catalog — throw to the error boundary ("try again") instead of
  // rendering "No sessions yet" during an outage.
  if (error) {
    throw new Error(`Couldn't load sessions: ${error.message}`);
  }
  if (!data) return [];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sessions = (data as unknown as SessionRow[]).map(mapRow);

  // Real enrollment counts (members can only read their own enrollment rows,
  // so counting requires the service role — aggregate only, nothing personal).
  // One query against the aggregate view (migration 0024); falls back to
  // downloading + counting rows if the view isn't deployed yet.
  if (sessions.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const service = createServiceClient();
    const counts = new Map<string, number>();
    const { data: viewRows, error: viewError } = await service
      .from("session_enrollment_counts")
      .select("session_id, enrolled")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );
    if (!viewError && viewRows) {
      for (const r of viewRows) counts.set(r.session_id, r.enrolled ?? 0);
    } else {
      const { data: allEnrollments } = await service
        .from("enrollments")
        .select("session_id")
        .in(
          "session_id",
          sessions.map((s) => s.id),
        );
      for (const e of allEnrollments ?? []) {
        counts.set(e.session_id, (counts.get(e.session_id) ?? 0) + 1);
      }
    }
    for (const s of sessions) s.enrolledCount = counts.get(s.id) ?? 0;
  }

  // Mark the viewer's enrollments.
  if (user) {
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("session_id, attended")
      .eq("profile_id", user.id);
    const byId = new Map(
      (enrollments ?? []).map((e) => [e.session_id, e.attended]),
    );
    for (const s of sessions) {
      if (byId.has(s.id)) {
        s.isEnrolled = true;
        s.attended = Boolean(byId.get(s.id));
      }
    }
  }

  return sessions;
});

export const getSession = requestCache(async (id: string): Promise<SessionDetail | null> => {
  if (!isSupabaseConfigured()) return getPlaceholderSession(id);

  const supabase = createClient();
  let res = await supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (res.error && /program|recurrence|host_name/.test(res.error.message)) {
    // Pre-migration fallback: the columns arrive with migration 0030.
    res = (await supabase
      .from("sessions")
      .select(SESSION_SELECT_LEGACY)
      .eq("id", id)
      .maybeSingle()) as typeof res;
  }
  const { data, error } = res;

  if (error || !data) return null;

  const session = mapRow(data as unknown as SessionRow);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? (await import("@/lib/supabase/admin")).createServiceClient()
    : null;

  // Viewer state, the aggregate count, and (optimistically) the join
  // credentials all run concurrently — this was a 4-stage serial waterfall.
  const [enrollmentRes, noteRes, countRes, joinRes] = await Promise.all([
    user
      ? supabase
          .from("enrollments")
          .select("attended")
          .eq("session_id", id)
          .eq("profile_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? supabase
          .from("session_notes")
          .select("body")
          .eq("session_id", id)
          .eq("profile_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    service
      ? service
          .from("enrollments")
          .select("id", { count: "exact", head: true })
          .eq("session_id", id)
      : Promise.resolve({ count: null }),
    service
      ? service
          .from("sessions")
          .select("zoom_join_url, zoom_meeting_id")
          .eq("id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (enrollmentRes.data) {
    session.isEnrolled = true;
    session.attended = Boolean(
      (enrollmentRes.data as { attended: boolean | null }).attended,
    );
  }
  const noteBody = (noteRes.data as { body?: string } | null)?.body;
  if (noteBody) session.note = noteBody;
  session.enrolledCount = countRes.count ?? 0;

  // Join credentials only exist for enrolled viewers — the columns are not
  // member-selectable (migration 0020), so this is the single hand-out
  // point. The row was fetched concurrently; it is only ATTACHED here,
  // after the enrollment check.
  if (session.isEnrolled && joinRes.data) {
    const j = joinRes.data as {
      zoom_join_url: string | null;
      zoom_meeting_id: string | null;
    };
    session.zoomJoinUrl = j.zoom_join_url ?? null;
    session.zoomMeetingId = j.zoom_meeting_id ?? null;
  }

  return session;
});
