import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { addGhlTags, badgeTag, upsertGhlContactId } from "@/lib/ghl";

/*
 * Pushing earned badges into GHL as contact tags (migration 0092).
 *
 * Matt wants offers aimed at badge holders, and offers are built in GHL —
 * so every badge a member earns becomes a tag on their contact, and the
 * campaign lives where campaigns already live. Nothing is built here that
 * GHL does better.
 *
 * ADDITIVE, in both directions. We only ever ADD tags: a tag removed by
 * hand in the CRM stays removed, and a badge someone has held for a year is
 * not re-pushed every night. The ledger's ghl_synced_at is the record of
 * what has been sent.
 */

/** Rows per run. GHL rate-limits, and this is a nightly background job. */
const MAX_PER_RUN = 400;

export interface BadgeTagResult {
  owed: number;
  tagged: number;
  contacts: number;
  failed: number;
  skipped: number;
  error?: string;
}

export async function pushBadgeTags(
  limit = MAX_PER_RUN,
): Promise<BadgeTagResult> {
  const empty: BadgeTagResult = {
    owed: 0,
    tagged: 0,
    contacts: 0,
    failed: 0,
    skipped: 0,
  };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...empty, error: "Database not configured" };
  }
  const { isGhlReady } = await import("@/lib/service-config");
  if (!(await isGhlReady())) {
    // Not an error: leave every row unsynced and let a later run — after the
    // key is configured — send them. Silently marking them done would lose
    // the tags for good.
    return { ...empty, error: "GHL not configured" };
  }

  const admin = createServiceClient();
  const { data: owed, error } = await admin
    .from("member_badges")
    .select("id, profile_id, badge_key")
    .is("ghl_synced_at", null)
    .order("earned_at", { ascending: true })
    .limit(limit);
  if (error) {
    // Pre-migration-0092 the column does not exist. Nothing owed yet.
    return { ...empty, error: error.message };
  }
  const rows = owed ?? [];
  if (rows.length === 0) return empty;

  // Group by member: one contact lookup and one tag call each, not one per
  // badge. A member crossing a level typically earns three or four at once.
  const byProfile = new Map<string, { ids: string[]; tags: string[] }>();
  for (const row of rows) {
    const id = String(row.profile_id);
    const entry = byProfile.get(id) ?? { ids: [], tags: [] };
    entry.ids.push(String(row.id));
    entry.tags.push(badgeTag(String(row.badge_key)));
    byProfile.set(id, entry);
  }

  const profileIds = [...byProfile.keys()];
  const [profiles, memberships] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, phone").in("id", profileIds),
    admin.from("memberships").select("profile_id, ghl_contact_id").in("profile_id", profileIds),
  ]);

  const contactByProfile = new Map<string, string>();
  for (const m of memberships.data ?? []) {
    const cid = m.ghl_contact_id ? String(m.ghl_contact_id) : "";
    if (cid && !contactByProfile.has(String(m.profile_id))) {
      contactByProfile.set(String(m.profile_id), cid);
    }
  }
  const profileById = new Map(
    (profiles.data ?? []).map((p) => [String(p.id), p]),
  );

  const now = new Date().toISOString();
  let tagged = 0;
  let contacts = 0;
  let failed = 0;
  let skipped = 0;

  for (const [profileId, entry] of byProfile) {
    const profile = profileById.get(profileId);
    let contactId = contactByProfile.get(profileId) ?? null;
    if (!contactId && profile?.email) {
      contactId = await upsertGhlContactId(String(profile.email), {
        phone: (profile.phone as string | null) ?? null,
        name: (profile.full_name as string | null) ?? null,
      });
    }
    if (!contactId) {
      // No contact and none could be created — leave the rows owed. The
      // member may simply have no email in GHL yet.
      skipped += entry.ids.length;
      continue;
    }

    const res = await addGhlTags(contactId, entry.tags);
    if (!res.ok) {
      failed += entry.ids.length;
      continue;
    }
    /*
     * Stamped only after GHL accepted the tags. The write can still fail
     * here, and then the tags are sent twice on the next run — harmless,
     * because adding a tag a contact already holds is a no-op. The reverse
     * (stamping first) would silently drop tags on a failed call.
     */
    await admin
      .from("member_badges")
      .update({ ghl_synced_at: now })
      .in("id", entry.ids);
    tagged += entry.ids.length;
    contacts += 1;
  }

  return { owed: rows.length, tagged, contacts, failed, skipped };
}
