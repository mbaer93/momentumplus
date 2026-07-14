import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AccessLevel, SessionCategory, SessionDetail } from "@/lib/types";
import { getPlaceholderSession, getPlaceholderSessions } from "./data";

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
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  speakers: { id: string; name: string; title: string | null } | null;
}

function mapRow(row: SessionRow): SessionDetail {
  const speakerName = row.speakers?.name ?? "TBA";
  return {
    id: row.id,
    slug: row.id,
    title: row.title,
    description: row.description ?? "",
    category: (row.category as SessionCategory) ?? "Leadership",
    objectives: [],
    speaker: {
      id: row.speakers?.id ?? "tba",
      name: speakerName,
      title: row.speakers?.title ?? "",
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
    zoomJoinUrl: row.zoom_join_url,
    zoomMeetingId: row.zoom_meeting_id,
    resources: [],
    aiSummary: null,
    isEnrolled: false,
    attended: false,
    note: "",
  };
}

const SESSION_SELECT =
  "id, title, description, category, starts_at, duration_min, capacity, min_access, status, zoom_meeting_id, zoom_join_url, speakers ( id, name, title )";

export async function listSessions(): Promise<SessionDetail[]> {
  if (!isSupabaseConfigured()) return getPlaceholderSessions();

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .order("starts_at", { ascending: true });

  if (error || !data) return getPlaceholderSessions();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sessions = (data as unknown as SessionRow[]).map(mapRow);

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
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  if (!isSupabaseConfigured()) return getPlaceholderSession(id);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return getPlaceholderSession(id);

  const session = mapRow(data as unknown as SessionRow);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const [{ data: enrollment }, { data: note }] = await Promise.all([
      supabase
        .from("enrollments")
        .select("attended")
        .eq("session_id", id)
        .eq("profile_id", user.id)
        .maybeSingle(),
      supabase
        .from("session_notes")
        .select("body")
        .eq("session_id", id)
        .eq("profile_id", user.id)
        .maybeSingle(),
    ]);
    if (enrollment) {
      session.isEnrolled = true;
      session.attended = Boolean(enrollment.attended);
    }
    if (note?.body) session.note = note.body;
  }

  return session;
}
