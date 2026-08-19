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

/*
 * What counts as having BOUGHT something.
 *
 * The four plans lib/pricing.ts sells are the obvious half. The other half
 * is not obvious and nearly cost a paying member their badge: a checkout
 * that Stripe has to heal (the webhook's missed-checkout path) writes the
 * membership as `basic` or `pro` — the member LEVEL — rather than the plan
 * they bought. Matt, 2026-08-19: "Basic is simply Momentum+ Member." So a
 * real customer can hold a `basic` row and would have been read here as a
 * comp, silently missing Founding Member with the receipt to disprove it.
 *
 * Hence the second rule: a member level counts when it arrived from a
 * PAYMENT source. Stripe and GHL take money; admin, zapier, tsls_import,
 * and sponsor are grants, and a granted `basic` is still a comp.
 */
export const PAID_TIERS = ["sub_monthly", "sub_3mo", "sub_6mo", "sub_annual"];
const LEVEL_TIERS = ["basic", "pro"];
const PAYMENT_SOURCES = ["stripe", "ghl"];

export function wasBought(tier: string, source: string | null): boolean {
  if (PAID_TIERS.includes(tier)) return true;
  return LEVEL_TIERS.includes(tier) && PAYMENT_SOURCES.includes(source ?? "");
}

/*
 * Founding Member is a CAPPED COHORT, not just a date window (Matt,
 * 2026-08-19): the first 100 people to buy, or everyone who buys before
 * October 1 2027 — whichever comes first.
 *
 * The cap is what makes this different in kind from every other badge. The
 * others are decidable from one member's own rows; this one cannot be
 * answered without looking at everybody, because whether you are the
 * hundredth or the hundred-and-first depends on people you have never met.
 * So the ranking lives here, pure and ordered, rather than as a comparison
 * scattered through the queries.
 */
export const FOUNDING_WINDOW_START = "2026-10-14T00:00:00Z";
/** Inclusive of October 1 2027 — the season clock this project counts by. */
export const FOUNDING_WINDOW_END = "2027-10-01T23:59:59Z";
export const FOUNDING_CAP = 100;

export interface FoundingCandidate {
  profileId: string;
  /** When they FIRST paid — the thing being ranked. */
  paidAt: string;
}

/**
 * The founding cohort: the first `cap` qualifying members by when they
 * first paid.
 *
 * Ordering is by paidAt, then profileId. The tiebreak is not decoration —
 * two people who bought in the same second must rank in an order that does
 * not change between runs, or the hundredth member is whoever the database
 * happened to return first tonight.
 *
 * A member who later cancels KEEPS their slot. They were one of the first
 * hundred; that is a fact about the past, and freeing the slot would hand
 * someone else a badge for a place they did not take.
 */
export function foundingCohort(
  candidates: FoundingCandidate[],
  opts?: { cap?: number; start?: string; end?: string },
): Set<string> {
  const cap = opts?.cap ?? FOUNDING_CAP;
  const start = opts?.start ?? FOUNDING_WINDOW_START;
  const end = opts?.end ?? FOUNDING_WINDOW_END;

  /*
   * Compared as TIME, never as strings. The same instant has several ISO
   * spellings — "…T00:00:00Z", "…T00:00:00.000Z", "…T00:00:00+00:00" — and
   * string order puts the millisecond form BEFORE the bare one ("." sorts
   * under "Z"), so a member who paid exactly at go-live would have been
   * ranked outside the window. Postgres returns the offset form, so this
   * was not hypothetical.
   */
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  // One entry per member, at their earliest qualifying payment.
  const earliest = new Map<string, number>();
  for (const c of candidates) {
    if (!c.profileId || !c.paidAt) continue;
    const paidMs = Date.parse(c.paidAt);
    if (!Number.isFinite(paidMs)) continue;
    if (paidMs < startMs || paidMs > endMs) continue;
    const prev = earliest.get(c.profileId);
    if (prev === undefined || paidMs < prev) earliest.set(c.profileId, paidMs);
  }

  return new Set(
    [...earliest.entries()]
      .sort(([aId, aAt], [bId, bAt]) =>
        aAt === bAt ? aId.localeCompare(bId) : aAt - bAt,
      )
      .slice(0, cap)
      .map(([id]) => id),
  );
}

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
    /*
     * "Here from the beginning" described the FIRST rule — anyone present at
     * launch. The rule now requires a paid subscription started in the launch
     * window, so the old line credited people the badge no longer goes to and
     * undersold the ones it does (Matt, 2026-08-19).
     */
    label: "Founding Member",
    description: "Backed Momentum+ from the start.",
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

/**
 * "1 course", "6 courses", "3 sessions with notes".
 *
 * Only the FIRST word is singularised: the unit is a noun phrase, and
 * "1 session with note" is worse than the plural bug it fixes.
 */
export function unitLabel(unit: string, count: number): string {
  if (count !== 1) return unit;
  const [head, ...rest] = unit.split(" ");
  const singular = head.endsWith("ies")
    ? `${head.slice(0, -3)}y`
    : head.endsWith("s")
      ? head.slice(0, -1)
      : head;
  return [singular, ...rest].join(" ");
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

/*
 * Stable keys for the badge ledger (migration 0091). These strings end up in
 * a database column, in GHL contact tags, and in the audience of an
 * announcement that has already been sent — so they are an interface, not a
 * label. Rename `label` freely; never rename a key.
 *
 *   attendance:gold      a track at a tier
 *   milestone:founding   a one-off
 *   level:committed      an overall level reached
 */
export function trackBadgeKey(track: BadgeTrackKey, tier: BadgeTier): string {
  return `${track}:${tier}`;
}

export function milestoneBadgeKey(key: MilestoneKey): string {
  return `milestone:${key}`;
}

export function levelBadgeKey(levelKey: string): string {
  return `level:${levelKey}`;
}

const TIER_ORDER: BadgeTier[] = ["bronze", "silver", "gold"];

/**
 * Every badge key a set of counts earns — including the LOWER tiers of each
 * track.
 *
 * Someone at Gold holds Bronze and Silver too, and writing all three down is
 * what makes "everyone who has reached In the Room, any tier" a single
 * `badge_key in (...)` rather than a tier comparison at every call site.
 */
export function earnedBadgeKeys(counts: BadgeCounts): string[] {
  const keys: string[] = [];
  for (const def of BADGE_TRACKS) {
    const count = counts[def.key];
    if (count === null || count === undefined) continue;
    const tier = tierFor(count, def.thresholds);
    if (!tier) continue;
    for (const t of TIER_ORDER) {
      keys.push(trackBadgeKey(def.key, t));
      if (t === tier) break;
    }
  }
  if (counts.summitAttendee) keys.push(milestoneBadgeKey("summit"));
  if (counts.foundingMember) keys.push(milestoneBadgeKey("founding"));
  if (counts.courses > 0) keys.push(milestoneBadgeKey("certified"));

  // The level reached, and every level below it — same reasoning as tiers.
  const points = pointsFor(counts);
  for (const level of OVERALL_LEVELS) {
    if (level.key === "start") continue; // Everyone is "Getting Started".
    if (points >= level.from) keys.push(levelBadgeKey(level.key));
  }
  return keys;
}

/** Human label for a badge key — admin UI, GHL tag names, audience lists. */
export function badgeKeyLabel(key: string): string {
  const [head, rest] = key.split(":");
  if (head === "milestone") {
    return BADGE_MILESTONES.find((m) => m.key === rest)?.label ?? rest;
  }
  if (head === "level") {
    return `${OVERALL_LEVELS.find((l) => l.key === rest)?.label ?? rest} (level)`;
  }
  const track = BADGE_TRACKS.find((t) => t.key === head);
  if (!track) return key;
  return `${track.label} — ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/**
 * Every badge that can be targeted, grouped for a picker. Order is the order
 * an admin reads them in: milestones (who they are), levels (how engaged),
 * then each track by tier.
 */
export function selectableBadges(): {
  key: string;
  label: string;
  group: string;
}[] {
  const out: { key: string; label: string; group: string }[] = [];
  for (const m of BADGE_MILESTONES) {
    out.push({ key: milestoneBadgeKey(m.key), label: m.label, group: "Milestones" });
  }
  for (const l of OVERALL_LEVELS) {
    if (l.key === "start") continue;
    out.push({ key: levelBadgeKey(l.key), label: l.label, group: "Engagement level" });
  }
  for (const t of BADGE_TRACKS) {
    for (const tier of TIER_ORDER) {
      out.push({
        key: trackBadgeKey(t.key, tier),
        label: `${t.label} — ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
        group: t.label,
      });
    }
  }
  return out;
}

/** Track points behind the overall level. */
export function pointsFor(counts: BadgeCounts): number {
  let points = 0;
  for (const def of BADGE_TRACKS) {
    const count = counts[def.key];
    if (count === null || count === undefined) continue;
    const tier = tierFor(count, def.thresholds);
    if (tier) points += TIER_POINTS[tier];
  }
  return points;
}

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
  opts?: { hidden?: boolean; everEarned?: Set<string> },
): MemberBadges {
  const tracks: EarnedTrack[] = [];
  let points = 0;
  /*
   * The ledger (migration 0091) overrides live counts UPWARD, never
   * downward. Matt's rule is "earned is earned": archive a course, unpublish
   * a session, and the count behind someone's badge drops — but the badge
   * they were shown, told about, and possibly given a deal for does not
   * disappear because of a change on our side. A member who genuinely loses
   * nothing sees no difference; this only ever matters when our own data
   * moves under them.
   */
  const ever = opts?.everEarned;
  const heldTier = (track: BadgeTrackKey): BadgeTier | null => {
    if (!ever) return null;
    for (const t of [...TIER_ORDER].reverse()) {
      if (ever.has(trackBadgeKey(track, t))) return t;
    }
    return null;
  };

  for (const def of BADGE_TRACKS) {
    const count = counts[def.key];
    if (count === null || count === undefined) continue;
    const live = tierFor(count, def.thresholds);
    const held = heldTier(def.key);
    const tier =
      held && (!live || TIER_ORDER.indexOf(held) > TIER_ORDER.indexOf(live))
        ? held
        : live;
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
    ever?.has(milestoneBadgeKey(m.key))
      ? true
      : m.key === "summit"
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
