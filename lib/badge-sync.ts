import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { badgeCountsForMany } from "@/lib/badge-queries";
import { earnedBadgeKeys } from "@/lib/badges";

/*
 * Writing badges down (migration 0091).
 *
 * APPEND ONLY. The sync inserts keys a member has earned and never deletes —
 * Matt's rule is "earned is earned" (2026-08-19), and once a deal hangs off
 * a badge, withdrawing one because a course got unpublished is a promise
 * broken by a content edit. Removing a badge is a deliberate admin act.
 *
 * Idempotent by the unique index on (profile_id, badge_key): re-running
 * changes nothing, so the cron can be re-fired freely and a partial run is
 * simply resumed by the next one.
 */

const BATCH = 200;

export interface BadgeSyncResult {
  scanned: number;
  awarded: number;
  /** Per-badge counts of what was newly written, for the run log. */
  newByKey: Record<string, number>;
  error?: string;
}

/**
 * Re-evaluate badges for the given members (or everyone, when omitted) and
 * write down anything newly earned.
 */
export async function syncMemberBadges(
  profileIds?: string[],
): Promise<BadgeSyncResult> {
  const empty: BadgeSyncResult = { scanned: 0, awarded: 0, newByKey: {} };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...empty, error: "Database not configured" };
  }
  const admin = createServiceClient();

  let ids = profileIds?.filter(Boolean) ?? [];
  if (!profileIds) {
    /*
     * Everyone with a membership — not every profile. An account with no
     * membership has nothing to have earned, and the members table is the
     * same population every other badge surface counts.
     */
    const { data, error } = await admin
      .from("memberships")
      .select("profile_id");
    if (error) return { ...empty, error: error.message };
    ids = [...new Set((data ?? []).map((r) => String(r.profile_id)))];
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) return empty;

  const newByKey: Record<string, number> = {};
  let awarded = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const [counts, existing] = await Promise.all([
      badgeCountsForMany(slice),
      admin
        .from("member_badges")
        .select("profile_id, badge_key")
        .in("profile_id", slice),
    ]);

    const held = new Map<string, Set<string>>();
    for (const row of existing.data ?? []) {
      const id = String(row.profile_id);
      const set = held.get(id) ?? new Set<string>();
      set.add(String(row.badge_key));
      held.set(id, set);
    }

    const rows: { profile_id: string; badge_key: string }[] = [];
    for (const [id, c] of counts) {
      const already = held.get(id) ?? new Set<string>();
      for (const key of earnedBadgeKeys(c)) {
        if (already.has(key)) continue;
        rows.push({ profile_id: id, badge_key: key });
        newByKey[key] = (newByKey[key] ?? 0) + 1;
      }
    }

    if (rows.length > 0) {
      // Ignore conflicts rather than update: earned_at is the FIRST time,
      // and an upsert would keep pushing it forward on every run.
      const { error } = await admin
        .from("member_badges")
        .upsert(rows, { onConflict: "profile_id,badge_key", ignoreDuplicates: true });
      if (error) {
        return { scanned: ids.length, awarded, newByKey, error: error.message };
      }
      awarded += rows.length;
    }
  }

  return { scanned: ids.length, awarded, newByKey };
}

/**
 * Members holding ANY of these badge keys — the audience query behind
 * badge-targeted announcements and offers.
 */
export async function profilesWithBadges(
  badgeKeys: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const keys = [...new Set(badgeKeys.filter(Boolean))];
  if (
    keys.length === 0 ||
    !isSupabaseConfigured() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return out;
  }
  const { data, error } = await createServiceClient()
    .from("member_badges")
    .select("profile_id")
    .in("badge_key", keys);
  /*
   * Fails CLOSED — an empty set, not "everyone". This feeds who gets
   * messaged and who gets an offer; a read error must never widen an
   * audience beyond what was chosen.
   */
  if (error) return new Set();
  for (const row of data ?? []) out.add(String(row.profile_id));
  return out;
}

/** How many members hold each badge — the admin's segment sizes. */
export async function badgeHolderCounts(): Promise<Record<string, number>> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {};
  }
  const { data, error } = await createServiceClient()
    .from("member_badges")
    .select("badge_key");
  if (error) return {};
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = String(row.badge_key);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
