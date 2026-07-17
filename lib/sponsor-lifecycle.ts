/*
 * Sponsor & speaker lifecycle rules (Matt, 2026-07-17): supporters join any
 * time, get a prep period to build their profile, stay live for the season,
 * and come down on OCTOBER 1 OF THE YEAR AFTER THEY JOINED. Expired or
 * archived supporters disappear from member surfaces but are never deleted
 * — they live in an admin-only archive with one-click reinstatement.
 */

/** Eastern-pinned "October 1, 00:00 ET" at or after `from`. */
export function nextOctoberFirst(from: Date = new Date()): Date {
  const yearEt = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(from),
  );
  // Oct 1 00:00 ET is 04:00 UTC (EDT). Fixed offset is correct here:
  // October 1 is always inside daylight-saving time.
  const thisYear = new Date(Date.UTC(yearEt, 9, 1, 4, 0, 0));
  return from < thisYear
    ? thisYear
    : new Date(Date.UTC(yearEt + 1, 9, 1, 4, 0, 0));
}

export interface SponsorLifecycleRow {
  archivedAt: string | null;
  expiresAt: string | null;
}

/** Visible to members: not archived, not past its expiry. */
export function sponsorActive(
  s: SponsorLifecycleRow,
  now: Date = new Date(),
): boolean {
  if (s.archivedAt) return false;
  if (s.expiresAt && new Date(s.expiresAt) <= now) return false;
  return true;
}


/**
 * Term end for a supporter who joins at `joined`: October 1 of the FOLLOWING
 * year (ET). Joining in July 2026 → prep through Oct 1 2026, live for the
 * season, down Oct 1 2027. Joining in November 2026 → also Oct 1 2027.
 */
export function seasonEnd(joined: Date = new Date()): Date {
  const yearEt = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(joined),
  );
  return new Date(Date.UTC(yearEt + 1, 9, 1, 4, 0, 0));
}
