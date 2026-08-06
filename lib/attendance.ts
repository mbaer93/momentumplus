import { createServiceClient } from "@/lib/supabase/admin";
import { getMeetingParticipants } from "@/lib/zoom";

/*
 * Zoom attendance matching for one session, shared by the attendance cron
 * sweep and the per-row admin "Pull attendance" action (audit P2-22).
 * Matching rules (identical to the original cron logic):
 *  - email first, lowercased on both sides (Zoom returns mixed case);
 *  - display-name fallback (guests often have no email in Zoom's report),
 *    but only when the name is UNIQUE among this session's enrollments —
 *    with two enrolled "John Smith"s, one attending would mark both.
 */

export interface AttendancePullResult {
  ok: boolean;
  matched: number;
  message?: string;
}

export async function pullSessionAttendance(
  sessionId: string,
  zoomMeetingId: string,
): Promise<AttendancePullResult> {
  const admin = createServiceClient();

  let participants;
  try {
    participants = await getMeetingParticipants(zoomMeetingId);
  } catch (e) {
    return {
      ok: false,
      matched: 0,
      message: `Zoom's participant report isn't available yet (${(e as Error).message}) — it can take a while after the meeting ends.`,
    };
  }

  const present = participants.filter((p) => p.duration > 0);
  const attendedEmails = new Set(
    present.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean),
  );
  const attendedNames = new Set(
    present.map((p) => (p.name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (attendedEmails.size === 0 && attendedNames.size === 0) {
    return { ok: true, matched: 0, message: "Zoom reported no participants." };
  }

  const { data: enrollments, error: enrollError } = await admin
    .from("enrollments")
    .select("id, profile_id, profiles ( email, full_name )")
    .eq("session_id", sessionId)
    .eq("attended", false);
  if (enrollError) {
    return { ok: false, matched: 0, message: enrollError.message };
  }

  const nameCounts = new Map<string, number>();
  for (const e of enrollments ?? []) {
    const n = (
      e as unknown as { profiles: { full_name: string | null } | null }
    ).profiles?.full_name
      ?.trim()
      .toLowerCase();
    if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  const toMark: string[] = [];
  for (const e of enrollments ?? []) {
    const p = (
      e as unknown as {
        profiles: { email: string; full_name: string | null } | null;
      }
    ).profiles;
    const email = p?.email?.toLowerCase();
    const name = p?.full_name?.trim().toLowerCase();
    if (
      (email && attendedEmails.has(email)) ||
      (name && attendedNames.has(name) && nameCounts.get(name) === 1)
    ) {
      toMark.push(e.id as string);
    }
  }

  if (toMark.length > 0) {
    const { error: markError } = await admin
      .from("enrollments")
      .update({ attended: true, attended_source: "zoom" })
      .in("id", toMark);
    if (markError) {
      return { ok: false, matched: 0, message: markError.message };
    }
  }
  return { ok: true, matched: toMark.length };
}
