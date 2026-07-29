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

/** The next October 1 (ET) after `now` — where the season flips. */
export function upcomingSeasonStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const pastBoundary = get("month") >= 10;
  return new Date(Date.UTC(get("year") + (pastBoundary ? 1 : 0), 9, 1, 4, 0, 0));
}

/**
 * Does this speaker/sponsor term run into NEXT season (the upcoming
 * October 1 through the October 1 after)? Terms all end on an October 1,
 * so "expires after the next boundary" is exactly "belongs to next
 * season" — the pre-season cohort, none of the current one.
 */
export function inNextSeason(
  s: SponsorLifecycleRow,
  now: Date = new Date(),
): boolean {
  if (s.archivedAt) return false;
  if (!s.expiresAt) return true; // ongoing (no end date) — in every season
  return new Date(s.expiresAt) > upcomingSeasonStart(now);
}

/**
 * A speaker is LIVE — listed in the directory, visible to members, able to
 * post — only during their season: from October 1 of the year they join
 * (their expires_at minus one year) until expires_at. Before that they're
 * onboarded and can build their page, but members don't see them.
 */
export function speakerLive(
  s: SponsorLifecycleRow,
  now: Date = new Date(),
): boolean {
  if (!sponsorActive(s, now)) return false;
  if (!s.expiresAt) return true; // legacy rows without lifecycle columns
  const seasonStart = new Date(s.expiresAt);
  seasonStart.setUTCFullYear(seasonStart.getUTCFullYear() - 1);
  return now >= seasonStart;
}

/**
 * Sponsors follow the identical season rule (Matt, 2026-07-20): onboard any
 * time, build the page during the prep period, but members don't see the
 * listing, rail ad, or profile until October 1 of the joining year.
 */
export const sponsorLive = speakerLive;


/**
 * Term end for a supporter who joins at `joined`: October 1 of the FOLLOWING
 * year (ET). Joining in July 2026 → prep through Oct 1 2026, live for the
 * season, down Oct 1 2027. Joining in November 2026 → also Oct 1 2027.
 * SPEAKERS only since 2026-07-29 — sponsors moved to the April clock
 * below.
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

/*
 * SPONSOR seasons run April 1 to April 1 (Matt, 2026-07-29, correcting the
 * short-lived September clock): a sponsor joins the season already in
 * progress — visible to members right away — and comes down at the NEXT
 * April 1. Speakers stay on the October 1 cycle above. Because the term
 * end is always less than a year out, the live window (sponsorLive:
 * expiry minus one year) opens immediately, so there is no pre-season
 * hiding for sponsors on this clock.
 */

/** Term end for a sponsor joining at `joined`: the next April 1 (ET).
    Joining July 2026 → live right away, down April 1 2027. Joining
    April 2027 → down April 1 2028. */
export function sponsorTermEnd(joined: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(joined);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  // April 1 00:00 ET is 04:00 UTC — April is always inside EDT.
  const pastBoundary = get("month") >= 4;
  return new Date(Date.UTC(get("year") + (pastBoundary ? 1 : 0), 3, 1, 4, 0, 0));
}

/** The next April 1 (ET) — the season boundary. Only sponsors whose term
    was manually pushed past next April are pre-season; on the standard
    clock everyone is live from the moment they're confirmed. */
export function upcomingSponsorReveal(now: Date = new Date()): Date {
  return sponsorTermEnd(now);
}

/** Sponsor counterpart of inNextSeason on the April boundary: does this
    term run past the next April 1? (The season tab's "next season" view.) */
export function inNextSponsorSeason(
  s: SponsorLifecycleRow,
  now: Date = new Date(),
): boolean {
  if (s.archivedAt) return false;
  if (!s.expiresAt) return true; // ongoing — in every season
  return new Date(s.expiresAt) > sponsorTermEnd(now);
}
