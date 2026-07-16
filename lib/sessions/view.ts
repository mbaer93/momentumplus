import type { SessionDetail } from "@/lib/types";

// Presentation + timing helpers for sessions. Pure and deterministic (given a
// `now`), so they are unit-tested in tests/session-view.test.ts.

export const JOIN_WINDOW_BEFORE_MS = 30 * 60 * 1000; // reveal 30 min before start

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
    now >= startMs(session) - JOIN_WINDOW_BEFORE_MS && now <= endMs(session)
  );
}

export function isLive(
  session: Pick<SessionDetail, "startsAt" | "durationMin">,
  now: number = Date.now(),
): boolean {
  return now >= startMs(session) && now <= endMs(session);
}

export type DisplayStatus = "live" | "upcoming" | "attended" | "enrolled" | "past";

export function displayStatus(
  session: Pick<
    SessionDetail,
    "startsAt" | "durationMin" | "isEnrolled" | "attended"
  >,
  now: number = Date.now(),
): DisplayStatus {
  if (isLive(session, now)) return "live";
  if (now > endMs(session)) return session.attended ? "attended" : "past";
  return session.isEnrolled ? "enrolled" : "upcoming";
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
    Leadership: "cat-leadership",
    Wellness: "cat-wellness",
    Business: "cat-business",
    Networking: "cat-networking",
  };
  return map[category] ?? "cat-leadership";
}
