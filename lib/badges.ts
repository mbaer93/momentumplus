/*
 * Engagement badges (Matt, 2026-08-18).
 *
 * Six tracks, three tiers each, plus one-off milestones and a single overall
 * level — the one thing compact enough to sit next to a name in the
 * directory or on a chat message.
 *
 * PURE. No database, no Supabase, no `await`. Every threshold and every
 * name is in this file, so changing what "Gold" means is an edit to a table
 * rather than a hunt through queries — and the rules can be tested without
 * standing up a database, which is the only way anyone will trust the
 * number shown against a member's name.
 *
 * Counting lives in lib/badge-queries.ts.
 */

export type BadgeTier = "bronze" | "silver" | "gold";

export interface BadgeTrackDef {
  key: BadgeTrackKey;
  /** Shown on the badge. DRAFT — Matt's to rewrite. */
  label: string;
  /** One line explaining what earns it, shown under the badge. DRAFT. */
  description: string;
  /** Count needed for [bronze, silver, gold]. Ascending, always. */
  thresholds: [number, number, number];
  /** Noun for the count: "3 sessions", "12 episodes". DRAFT. */
  unit: string;
}

export type BadgeTrackKey =
  | "attendance"
  | "notes"
  | "courses"
  | "podcast"
  | "community"
  | "tenure";

/*
 * Thresholds are set against real cadence, not round numbers: sessions run
 * monthly, so Gold at 10 is about a year of showing up, and the podcast is
 * weekly, so 30 episodes is roughly seven months of listening. Too low and
 * Gold means nothing; too high and nobody sees a second tier in year one.
 */
export const BADGE_TRACKS: BadgeTrackDef[] = [
  {
    key: "attendance",
    label: "In the Room",
    description: "Live sessions attended — not just enrolled in.",
    thresholds: [1, 4, 10],
    unit: "sessions",
  },
  {
    key: "notes",
    label: "On the Record",
    description: "Sessions you took private notes on.",
    thresholds: [1, 5, 12],
    unit: "sessions with notes",
  },
  {
    key: "courses",
    label: "Coursework",
    description: "Self-paced courses finished end to end.",
    thresholds: [1, 3, 6],
    unit: "courses",
  },
  {
    key: "podcast",
    label: "Tuned In",
    description: "Branching Out episodes listened to in full.",
    thresholds: [3, 12, 30],
    unit: "episodes",
  },
  {
    key: "community",
    label: "In the Conversation",
    description: "Messages posted in the community.",
    thresholds: [1, 20, 75],
    unit: "messages",
  },
  {
    key: "tenure",
    label: "Staying Power",
    description: "Months of continuous membership.",
    thresholds: [3, 12, 24],
    unit: "months",
  },
];

export type MilestoneKey = "summit" | "founding" | "certified";

export interface MilestoneDef {
  key: MilestoneKey;
  /** DRAFT — Matt's to rewrite. */
  label: string;
  description: string;
}

/** Earned once, no tiers. */
export const BADGE_MILESTONES: MilestoneDef[] = [
  {
    key: "summit",
    label: "Summit Attendee",
    description: "Came to the Tri-State Leadership Summit.",
  },
  {
    key: "founding",
    label: "Founding Member",
    description: "Here from the beginning.",
  },
  {
    key: "certified",
    label: "Certified",
    description: "Earned a certificate of completion.",
  },
];

/** Raw counts behind the badges. `null` = not measured (see community). */
export interface BadgeCounts {
  attendance: number;
  notes: number;
  courses: number;
  podcast: number;
  /*
   * Community messages live in Stream, not in our database, so counting them
   * needs its own plumbing (a webhook writing counts here, or a periodic
   * pull). Until that exists this is null — NOT zero. Zero would award a
   * member the bottom of a track they may well have earned, and would say
   * "0 messages" to someone who posts every day.
   */
  community: number | null;
  tenure: number;
  summitAttendee: boolean;
  foundingMember: boolean;
}

export interface EarnedTrack {
  key: BadgeTrackKey;
  label: string;
  description: string;
  tier: BadgeTier;
  count: number;
  /** Count needed for the next tier, or null at Gold. */
  nextAt: number | null;
}

export interface MemberBadges {
  tracks: EarnedTrack[];
  milestones: MilestoneDef[];
  /** 0–18: 1/2/3 per track earned. */
  points: number;
  level: OverallLevel;
  /** The member has chosen to keep these off their public surfaces. */
  hidden: boolean;
}

/** The tier this count has reached, or null when it hasn't reached bronze. */
export function tierFor(
  count: number | null,
  thresholds: [number, number, number],
): BadgeTier | null {
  if (count === null) return null;
  if (count >= thresholds[2]) return "gold";
  if (count >= thresholds[1]) return "silver";
  if (count >= thresholds[0]) return "bronze";
  return null;
}

/** What the member needs for their next tier, or null once at gold. */
export function nextThreshold(
  count: number | null,
  thresholds: [number, number, number],
): number | null {
  if (count === null) return thresholds[0];
  return thresholds.find((t) => count < t) ?? null;
}

const TIER_POINTS: Record<BadgeTier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
};

export interface OverallLevel {
  key: string;
  /** DRAFT — Matt's to rewrite. */
  label: string;
  /** Lowest point total that reaches this level. */
  from: number;
}

/*
 * Bands, not a bar with a maximum: a member should never see "18 points"
 * and read it as a score they are failing. The top band is reachable
 * without every track — 15 of 18 means five golds or a spread — because
 * nobody does all six things, and a level nobody reaches motivates nobody.
 */
export const OVERALL_LEVELS: OverallLevel[] = [
  { key: "start", label: "Getting Started", from: 0 },
  { key: "engaged", label: "Engaged", from: 3 },
  { key: "committed", label: "Committed", from: 7 },
  { key: "driving", label: "Driving", from: 11 },
  { key: "all_in", label: "All In", from: 15 },
];

export function levelForPoints(points: number): OverallLevel {
  // Highest band whose floor we've reached. Reversed so the first match wins.
  return (
    [...OVERALL_LEVELS].reverse().find((l) => points >= l.from) ??
    OVERALL_LEVELS[0]
  );
}

/**
 * Turn raw counts into the badges a member has earned.
 *
 * Tracks that have earned nothing are RETURNED, at tier null — filtered out
 * by callers that show only earned badges, and kept by the profile, where
 * "4 more sessions for Bronze" is the whole point. A track with a null
 * count (community, until Stream is wired) is dropped entirely rather than
 * shown as unearned: an empty track a member cannot fill reads as a bug.
 */
export function badgesFrom(
  counts: BadgeCounts,
  opts?: { hidden?: boolean },
): MemberBadges {
  const tracks: EarnedTrack[] = [];
  let points = 0;

  for (const def of BADGE_TRACKS) {
    const count = counts[def.key];
    if (count === null || count === undefined) continue;
    const tier = tierFor(count, def.thresholds);
    if (tier) points += TIER_POINTS[tier];
    tracks.push({
      key: def.key,
      label: def.label,
      description: def.description,
      tier: tier ?? ("bronze" as BadgeTier),
      count,
      nextAt: nextThreshold(count, def.thresholds),
    });
  }

  const milestones = BADGE_MILESTONES.filter((m) =>
    m.key === "summit"
      ? counts.summitAttendee
      : m.key === "founding"
        ? counts.foundingMember
        : counts.courses > 0,
  );

  return {
    tracks,
    milestones,
    points,
    level: levelForPoints(points),
    hidden: opts?.hidden === true,
  };
}

/** Earned tracks only — for the compact views (directory, chat). */
export function earnedTracks(badges: MemberBadges): EarnedTrack[] {
  return badges.tracks.filter((t) => {
    const def = BADGE_TRACKS.find((d) => d.key === t.key);
    return def ? tierFor(t.count, def.thresholds) !== null : false;
  });
}
