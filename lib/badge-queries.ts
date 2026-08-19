import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";
import { badgesFrom, type BadgeCounts, type MemberBadges } from "@/lib/badges";

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

/** Momentum+ opened to members on this date — see BADGE_MILESTONES.founding. */
const FOUNDING_CUTOFF = "2026-10-14T23:59:59Z";

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

  const [attendance, notes, podcast, memberships, courseRows] =
    await Promise.all([
      admin
        .from("enrollments")
        .select("profile_id")
        .in("profile_id", ids)
        .eq("attended", true),
      admin.from("session_notes").select("profile_id, body").in("profile_id", ids),
      admin
        .from("podcast_episode_progress")
        .select("profile_id")
        .in("profile_id", ids)
        .eq("completed", true),
      admin
        .from("memberships")
        .select("profile_id, tier, status, access_starts_at, created_at")
        .in("profile_id", ids),
      // Course completion needs the lesson→course map, so it is counted
      // separately below.
      admin
        .from("lesson_progress")
        .select("profile_id, lesson_id")
        .in("profile_id", ids)
        .not("completed_at", "is", null),
    ]);

  for (const row of attendance.data ?? []) bump(String(row.profile_id), "attendance");
  for (const row of notes.data ?? []) {
    // An empty note row is created by opening the editor — it is not a note.
    if (String(row.body ?? "").trim()) bump(String(row.profile_id), "notes");
  }
  for (const row of podcast.data ?? []) bump(String(row.profile_id), "podcast");

  // Tenure, summit, founding — all from the membership rows.
  const now = Date.now();
  const earliest = new Map<string, string>();
  for (const row of memberships.data ?? []) {
    const id = String(row.profile_id);
    const target = out.get(id);
    if (!target) continue;
    if (SUMMIT_TIERS.includes(String(row.tier))) target.summitAttendee = true;
    const joined = (row.access_starts_at ?? row.created_at) as string | null;
    if (joined) {
      const prev = earliest.get(id);
      if (!prev || joined < prev) earliest.set(id, joined);
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
    target.foundingMember = joined <= FOUNDING_CUTOFF;
  }

  // Courses: a course counts once every one of its lessons is complete.
  const completedLessons = new Map<string, Set<string>>();
  for (const row of courseRows.data ?? []) {
    const id = String(row.profile_id);
    const set = completedLessons.get(id) ?? new Set<string>();
    set.add(String(row.lesson_id));
    completedLessons.set(id, set);
  }
  if (completedLessons.size > 0) {
    const { data: lessons } = await admin
      .from("course_lessons")
      .select("id, course_id");
    const byCourse = new Map<string, string[]>();
    for (const row of lessons ?? []) {
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

/** Badges for one member — their own profile page. */
export const badgesForProfile = requestCache(
  async (profileId: string): Promise<MemberBadges> => {
    const counts = await badgeCountsForMany([profileId]);
    const hidden = await hiddenBadgeProfiles([profileId]);
    return badgesFrom(counts.get(profileId) ?? EMPTY, {
      hidden: hidden.has(profileId),
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
  const [counts, hidden] = await Promise.all([
    badgeCountsForMany(profileIds),
    hiddenBadgeProfiles(profileIds),
  ]);
  const out = new Map<string, MemberBadges>();
  for (const [id, c] of counts) {
    if (hidden.has(id)) continue;
    out.set(id, badgesFrom(c));
  }
  return out;
}
