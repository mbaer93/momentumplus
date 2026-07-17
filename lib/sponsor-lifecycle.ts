/*
 * Sponsor lifecycle rules (Matt, 2026-07-17): sponsorships and their reps'
 * Pro access run through OCTOBER 1 each year. Expired/archived sponsors
 * disappear from member surfaces but are never deleted — they live in an
 * admin-only Past Sponsors archive with one-click reinstatement.
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
