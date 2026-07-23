import type { SessionDetail } from "@/lib/types";

// Presentation + timing helpers for sessions. Pure and deterministic (given a
// `now`), so they are unit-tested in tests/session-view.test.ts.

export const JOIN_WINDOW_BEFORE_MS = 30 * 60 * 1000; // reveal 30 min before start

/** Sessions routinely run past their scheduled end — keep the room joinable
    for this long after so late refreshes don't hit "this session has ended"
    while the host is mid-sentence. */
export const JOIN_WINDOW_OVERRUN_MS = 60 * 60 * 1000;

const TZ = "America/New_York"; // TSLS is a Tri-State (ET) program

export function startMs(session: Pick<SessionDetail, "startsAt">): number {
  return new Date(session.startsAt).getTime();
}

export function endMs(
  session: Pick<SessionDetail, "startsAt" | "durationMin">,
): number {
  return startMs(session) + session.durationMin * 60 * 1000;
}

/**
 * The Zoom join URL / live room is revealed from 30 minutes before start until
 * the session ends (SPEC.md §4). `now` is injectable for testing.
 */
export function isJoinWindowOpen(
  session: Pick<SessionDetail, "startsAt" | "durationMin">,
  now: number = Date.now(),
): boolean {
  return (
    now >= startMs(session) - JOIN_WINDOW_BEFORE_MS &&
    now <= endMs(session) + JOIN_WINDOW_OVERRUN_MS
  );
}

export function isLive(
  session: Pick<SessionDetail, "startsAt" | "durationMin">,
  now: number = Date.now(),
): boolean {
  return now >= startMs(session) && now <= endMs(session);
}

export type DisplayStatus =
  | "live"
  | "upcoming"
  | "attended"
  | "enrolled"
  | "past"
  | "cancelled"
  | "draft";

export function displayStatus(
  session: Pick<
    SessionDetail,
    "startsAt" | "durationMin" | "isEnrolled" | "attended" | "status"
  >,
  now: number = Date.now(),
): DisplayStatus {
  // The database status wins over the clock: a cancelled or archived
  // session must never show a live Enroll button just because its date is
  // in the future.
  if (session.status === "cancelled") return "cancelled";
  if (session.status === "draft") return "draft";
  if (session.status === "completed" || session.status === "archived") {
    return session.attended ? "attended" : "past";
  }
  if (isLive(session, now)) return "live";
  if (now > endMs(session)) return session.attended ? "attended" : "past";
  return session.isEnrolled ? "enrolled" : "upcoming";
}

/** True when members can still sign up (scheduled, in the future, seats left). */
export function canEnroll(
  session: Pick<
    SessionDetail,
    "startsAt" | "durationMin" | "status" | "capacity" | "enrolledCount" | "isEnrolled"
  >,
  now: number = Date.now(),
): { ok: boolean; reason: "cancelled" | "past" | "full" | null } {
  if (session.status === "cancelled") return { ok: false, reason: "cancelled" };
  if (
    session.status === "completed" ||
    session.status === "archived" ||
    now > endMs(session)
  ) {
    return { ok: false, reason: "past" };
  }
  if (
    !session.isEnrolled &&
    session.capacity !== null &&
    session.enrolledCount >= session.capacity
  ) {
    return { ok: false, reason: "full" };
  }
  return { ok: true, reason: null };
}

export function dateLabel(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(startsAt));
}

export function timeLabel(startsAt: string): string {
  // timeZoneName gives the seasonally correct EST/EDT instead of a
  // hardcoded "EST" that mislabels eight months of the year.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(startsAt));
}

export function monthShort(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
  })
    .format(new Date(startsAt))
    .toUpperCase();
}

export function dayOfMonth(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    day: "numeric",
  }).format(new Date(startsAt));
}

export function durationLabel(durationMin: number): string {
  if (durationMin < 60) return `${durationMin} min`;
  const hours = durationMin / 60;
  if (Number.isInteger(hours)) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${durationMin} min`;
}

export function categoryClass(category: string): string {
  const map: Record<string, string> = {
    // Current taxonomy (Sierra, 2026-07-22)
    "Monthly Educational Session": "cat-leadership",
    "Accountability Session": "cat-wellness",
    "Productivity Session": "cat-business",
    "AI Leadership Lab": "cat-networking",
    "Bonus Sessions": "cat-leadership",
    // Legacy values on older rows
    Leadership: "cat-leadership",
    Wellness: "cat-wellness",
    Business: "cat-business",
    Networking: "cat-networking",
  };
  return map[category] ?? "cat-leadership";
}
