import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";
import {
  badgesFrom,
  foundingCohort,
  wasBought,
  type BadgeCounts,
  type FoundingCandidate,
  type MemberBadges,
} from "@/lib/badges";

/*
 * Counting for lib/badges.ts.
 *
 * BATCH BY DEFAULT. The member directory renders 24 people a page and the
 * chat renders a name per message — one query per member per track would be
 * 144 round trips for a single directory page. Everything here takes a LIST
 * of profile ids and counts in one pass per source, then buckets in JS.
 *
 * Service role throughout: session notes and podcast progress are
 * owner-only under RLS (correct — the CONTENT is private), but a badge is
 * an aggregate, and the directory has to be able to count rows belonging to
 * someone other than the viewer. Only counts ever leave this file; no note
 * body, no episode title, no session name.
 */

const EMPTY: BadgeCounts = {
  attendance: 0,
  notes: 0,
  courses: 0,
  podcast: 0,
  community: null,
  tenure: 0,
  summitAttendee: false,
  foundingMember: false,
};

/*
 * Founding Member: bought a subscription in the launch window (Matt,
 * 2026-08-19).
 *
 * The first cut of this said "any membership starting on or before go-live",
 * which on day one would have decorated essentially every account in the
 * database — imported summit attendees, gift tiers, comped speakers and
 * sponsors, and the test accounts — with a badge reading "Here from the
 * beginning". A badge everyone has says nothing.
 *
 * So it is scoped to money and to a window: the member's earliest PAID
 * subscription has to start between go-live and the end of 2026. It marks
 * the people who paid for an unproven product in its first months, which is
 * the thing worth remembering them for.
 */

/** Tiers that mean "came to the summit". */
const SUMMIT_TIERS = ["tsls_attendee", "tsls_vip"];

function monthsBetween(fromIso: string, now: number): number {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start) || start > now) return 0;
  // Whole months only: "1 month" should not appear on day two.
  return Math.floor((now - start) / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Raw counts for a list of members, keyed by profile id.
 *
 * Fails SOFT, per source. A failed query leaves that track at zero rather
 * than throwing, because a badge strip is decoration on someone else's
 * page: a directory that 500s because the podcast table hiccuped is a far
 * worse outcome than a member's "Tuned In" badge going missing for an hour.
 */
/**
 * The founding cohort, resolved once per request.
 *
 * Every other badge count is answerable from one member's own rows. This
 * one is not: whether someone is inside the first hundred depends on
 * everybody else, so it needs the whole population — and it is therefore
 * cached per request rather than recomputed for every batch of 200 members
 * the directory renders.
 *
 * Fails CLOSED to an empty set. A read error must not hand the badge to
 * everyone; a missing badge is recoverable on the next run, an
 * over-awarded one is not (the ledger is append-only, so a wrongly awarded
 * Founding Member is permanent).
 */
export const foundingMemberIds = requestCache(async (): Promise<Set<string>> => {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Set();
  }
  const admin = createServiceClient();
  const { rows, error } = await allRows<{
    profile_id: string;
    tier: string;
    source: string | null;
    access_starts_at: string | null;
    created_at: string | null;
  }>((from, to) =>
    admin
      .from("memberships")
      .select("profile_id, tier, source, access_starts_at, created_at")
      .order("profile_id")
      .range(from, to),
  );
  if (error) return new Set();

  /*
   * Test accounts cannot take a slot. There are only a hundred, and a
   * tester holding one means a real member who paid does not — the kind of
   * thing nobody would find until someone counted.
   */
  const { data: testers } = await admin
    .from("profiles")
    .select("id")
    .eq("tester", true);
  const excluded = new Set((testers ?? []).map((t) => String(t.id)));

  const candidates: FoundingCandidate[] = [];
  for (const row of rows) {
    const id = String(row.profile_id);
    if (excluded.has(id)) continue;
    if (!wasBought(String(row.tier), row.source ?? null)) continue;
    const paidAt = (row.access_starts_at ?? row.created_at) as string | null;
    if (paidAt) candidates.push({ profileId: id, paidAt });
  }
  return foundingCohort(candidates);
});

export async function badgeCountsForMany(
  profileIds: string[],
): Promise<Map<string, BadgeCounts>> {
  const out = new Map<string, BadgeCounts>();
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { ...EMPTY });
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return out;
  }

  const admin = createServiceClient();
  const bump = (id: string, key: "attendance" | "notes" | "podcast") => {
    const row = out.get(id);
    if (row) row[key] += 1;
  };

  /*
   * Every one of these is PAGED. They are counts across a batch of members,
   * and a plain select stops at PostgREST's ceiling in silence — a member
   * whose rows fell past the cut is simply undercounted, which shows up as
   * a badge that never arrives rather than as an error anyone can see.
   * (Append-only badges mean the damage is a delay, not a withdrawal, but a
   * count that quietly disagrees with the member's own history is still the
   * kind of thing nobody would think to look for.)
   */
  const [attendance, notes, podcast, memberships, courseRows] =
    await Promise.all([
      allRows<{ profile_id: string }>((from, to) =>
        admin
          .from("enrollments")
          .select("profile_id")
          .in("profile_id", ids)
          .eq("attended", true)
          .order("profile_id")
          .range(from, to),
      ),
      allRows<{ profile_id: string; body: string | null }>((from, to) =>
        admin
          .from("session_notes")
          .select("profile_id, body")
          .in("profile_id", ids)
          .order("profile_id")
          .range(from, to),
      ),
      allRows<{ profile_id: string }>((from, to) =>
        admin
          .from("podcast_episode_progress")
          .select("profile_id")
          .in("profile_id", ids)
          .eq("completed", true)
          .order("profile_id")
          .range(from, to),
      ),
      allRows<{
        profile_id: string;
        tier: string;
        status: string;
        source: string | null;
        access_starts_at: string | null;
        created_at: string | null;
      }>((from, to) =>
        admin
          .from("memberships")
          .select("profile_id, tier, status, source, access_starts_at, created_at")
          .in("profile_id", ids)
          .order("profile_id")
          .range(from, to),
      ),
      // Course completion needs the lesson→course map, so it is counted
      // separately below.
      allRows<{ profile_id: string; lesson_id: string }>((from, to) =>
        admin
          .from("lesson_progress")
          .select("profile_id, lesson_id")
          .in("profile_id", ids)
          .not("completed_at", "is", null)
          .order("profile_id")
          .range(from, to),
      ),
    ]);

  /*
   * Community messages (0094). Stored by the Stream pull, not counted here.
   *
   * The distinction that matters is measured-but-zero versus not-measured:
   * null hides the track entirely, 0 shows it as "1 more for Bronze". The
   * table having ANY rows is what says the pull has run — a member with no
   * row is then genuinely someone who has not posted, rather than someone
   * we have not counted yet.
   */
  const community = await admin
    .from("community_message_counts")
    .select("profile_id, messages")
    .in("profile_id", ids);
  if (!community.error) {
    const counted = new Map(
      (community.data ?? []).map((r) => [String(r.profile_id), Number(r.messages) || 0]),
    );
    let everCounted = counted.size > 0;
    if (!everCounted) {
      // Nobody in this batch has posted. Has ANYONE? One cheap head count
      // separates "quiet members" from "the pull has never run".
      const { count } = await admin
        .from("community_message_counts")
        .select("profile_id", { count: "exact", head: true });
      everCounted = (count ?? 0) > 0;
    }
    if (everCounted) {
      for (const [id, target] of out) {
        target.community = counted.get(id) ?? 0;
      }
    }
  }

  for (const row of attendance.rows) bump(String(row.profile_id), "attendance");
  for (const row of notes.rows) {
    // An empty note row is created by opening the editor — it is not a note.
    if (String(row.body ?? "").trim()) bump(String(row.profile_id), "notes");
  }
  for (const row of podcast.rows) bump(String(row.profile_id), "podcast");

  // Tenure, summit, founding — all from the membership rows.
  const now = Date.now();
  const earliest = new Map<string, string>();
  const earliestPaid = new Map<string, string>();
  for (const row of memberships.rows) {
    const id = String(row.profile_id);
    const target = out.get(id);
    if (!target) continue;
    if (SUMMIT_TIERS.includes(String(row.tier))) target.summitAttendee = true;
    const joined = (row.access_starts_at ?? row.created_at) as string | null;
    if (joined) {
      const prev = earliest.get(id);
      if (!prev || joined < prev) earliest.set(id, joined);
      if (wasBought(String(row.tier), row.source ?? null)) {
        const prevPaid = earliestPaid.get(id);
        if (!prevPaid || joined < prevPaid) earliestPaid.set(id, joined);
      }
    }
  }
  for (const [id, joined] of earliest) {
    const target = out.get(id);
    if (!target) continue;
    /*
     * Tenure counts from the FIRST membership, not the current one. A member
     * who renewed, or moved from a TSLS gift to a paid plan, has not been
     * here for zero months — resetting their longest-running badge at the
     * moment they give us money would be perverse.
     */
    target.tenure = monthsBetween(joined, now);
  }
  /*
   * Founding Member is decided by the cohort, not by this member's dates —
   * the cap means the window closing early is a thing that happens to
   * everyone at once. earliestPaid is still computed above because it is
   * what the cohort ranks on.
   */
  const founding = await foundingMemberIds();
  for (const id of earliestPaid.keys()) {
    const target = out.get(id);
    if (target) target.foundingMember = founding.has(id);
  }

  /*
   * Test accounts never earn it. They are hidden from members anyway, but a
   * tester marked at a paid tier would otherwise be counted among the people
   * who actually bought something — and the number of founding members is
   * exactly the kind of thing that ends up in copy.
   */
  const { data: testers } = await admin
    .from("profiles")
    .select("id")
    .in("id", ids)
    .eq("tester", true);
  for (const row of testers ?? []) {
    const target = out.get(String(row.id));
    if (target) target.foundingMember = false;
  }

  // Courses: a course counts once every one of its lessons is complete.
  const completedLessons = new Map<string, Set<string>>();
  for (const row of courseRows.rows) {
    const id = String(row.profile_id);
    const set = completedLessons.get(id) ?? new Set<string>();
    set.add(String(row.lesson_id));
    completedLessons.set(id, set);
  }
  if (completedLessons.size > 0) {
    // Paged: the whole lesson→course map, which grows with the library.
    const { rows: lessons } = await allRows<{ id: string; course_id: string }>(
      (from, to) =>
        admin
          .from("course_lessons")
          .select("id, course_id")
          .order("id")
          .range(from, to),
    );
    const byCourse = new Map<string, string[]>();
    for (const row of lessons) {
      const courseId = String(row.course_id);
      byCourse.set(courseId, [...(byCourse.get(courseId) ?? []), String(row.id)]);
    }
    for (const [id, done] of completedLessons) {
      const target = out.get(id);
      if (!target) continue;
      let finished = 0;
      for (const [, lessonIds] of byCourse) {
        // A course with no lessons is not an achievement.
        if (lessonIds.length > 0 && lessonIds.every((l) => done.has(l))) {
          finished += 1;
        }
      }
      target.courses = finished;
    }
  }

  return out;
}

/** Which of these members have hidden their badges. */
export async function hiddenBadgeProfiles(
  profileIds: string[],
): Promise<Set<string>> {
  if (
    profileIds.length === 0 ||
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return new Set();
  }
  const { data, error } = await createServiceClient()
    .from("profiles")
    .select("id")
    .in("id", profileIds)
    .eq("hide_badges", true);
  /*
   * Fails CLOSED, unlike the counts. An error here means we do not know who
   * opted out, and showing a badge someone asked us to hide is not
   * recoverable by a later page load — so treat everyone as hidden until we
   * can read the column. Pre-migration 0090 this is also the honest answer:
   * nobody has been able to opt in yet.
   */
  if (error) return new Set(profileIds);
  return new Set((data ?? []).map((r) => String(r.id)));
}

/**
 * Badge keys these members have EVER earned, from the ledger (0091).
 *
 * Fails soft to an empty map: the ledger only ever raises what the live
 * counts already say, so losing it degrades to today's behaviour rather
 * than to a wrong answer. Pre-migration that is also the only answer.
 */
export async function everEarnedBadges(
  profileIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (
    profileIds.length === 0 ||
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return out;
  }
  // Paged: a chat roster or a directory page carries dozens of members, and
  // each can hold a couple of dozen badges — the ceiling is closer than it
  // looks, and a truncated ledger silently un-earns someone's badge.
  const admin = createServiceClient();
  const { rows, error } = await allRows<{
    profile_id: string;
    badge_key: string;
  }>((from, to) =>
    admin
      .from("member_badges")
      .select("profile_id, badge_key")
      .in("profile_id", profileIds)
      .order("profile_id")
      .range(from, to),
  );
  if (error) return out;
  for (const row of rows) {
    const id = String(row.profile_id);
    const set = out.get(id) ?? new Set<string>();
    set.add(String(row.badge_key));
    out.set(id, set);
  }
  return out;
}

/** Badges for one member — their own profile page. */
export const badgesForProfile = requestCache(
  async (profileId: string): Promise<MemberBadges> => {
    const [counts, hidden, ever] = await Promise.all([
      badgeCountsForMany([profileId]),
      hiddenBadgeProfiles([profileId]),
      everEarnedBadges([profileId]),
    ]);
    return badgesFrom(counts.get(profileId) ?? EMPTY, {
      hidden: hidden.has(profileId),
      everEarned: ever.get(profileId),
    });
  },
);

/**
 * Badges for a list of members, as shown to SOMEONE ELSE.
 *
 * Members who opted out are absent from the map entirely rather than
 * present-and-empty: a caller that forgets to check `hidden` then renders
 * nothing, instead of rendering a badge its owner asked us to hide.
 */
export async function badgesForOthers(
  profileIds: string[],
): Promise<Map<string, MemberBadges>> {
  const [counts, hidden, ever] = await Promise.all([
    badgeCountsForMany(profileIds),
    hiddenBadgeProfiles(profileIds),
    everEarnedBadges(profileIds),
  ]);
  const out = new Map<string, MemberBadges>();
  for (const [id, c] of counts) {
    if (hidden.has(id)) continue;
    out.set(id, badgesFrom(c, { everEarned: ever.get(id) }));
  }
  return out;
}
