import { createServiceClient } from "@/lib/supabase/admin";

/*
 * The rep who runs a sponsor page holds the `sponsor` member tier
 * (Pro-equivalent access, season-bound). The tier enum value arrives in
 * migration 0037 — until it runs, grants fall back to the old comped-Pro
 * row so onboarding never locks a rep out, and 0038 converts those rows.
 */
export async function upsertSponsorMembership(
  profileId: string,
  termEnd: string,
  /** true = the rep who runs the page (sponsor tier); false = a comped seat
      member (stays Pro). */
  rep: boolean,
): Promise<{ error: string | null }> {
  const admin = createServiceClient();
  // Source (not tier) identifies sponsor-granted rows, so this finds both
  // new `sponsor` rows and pre-migration `pro` fallback rows. VIP-ticket
  // rows (tier=vip, source=sponsor) are a different grant and must never be
  // mistaken for the page-runner's free membership.
  const { data: existing, error: lookupError } = await admin
    .from("memberships")
    .select("id, tier")
    .eq("profile_id", profileId)
    .eq("source", "sponsor")
    .neq("tier", "vip")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };

  if (existing) {
    const { error } = await admin
      .from("memberships")
      .update({ status: "active", access_expires_at: termEnd })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    if (rep && existing.tier === "pro") {
      // Old comped-Pro rep row: move it to the sponsor tier now that we can.
      // Fails harmlessly before migration 0037 (0038 converts it later).
      await admin
        .from("memberships")
        .update({ tier: "sponsor" })
        .eq("id", existing.id);
    }
    return { error: null };
  }

  const row = {
    profile_id: profileId,
    status: "active",
    access_starts_at: new Date().toISOString(),
    access_expires_at: termEnd,
    source: "sponsor",
  };
  if (!rep) {
    const { error } = await admin.from("memberships").insert({ ...row, tier: "pro" });
    return { error: error?.message ?? null };
  }
  const { error: insertError } = await admin
    .from("memberships")
    .insert({ ...row, tier: "sponsor" });
  if (!insertError) return { error: null };
  if (/access_tier|invalid input value/i.test(insertError.message)) {
    const { error: fallbackError } = await admin
      .from("memberships")
      .insert({ ...row, tier: "pro" });
    return { error: fallbackError?.message ?? null };
  }
  return { error: insertError.message };
}

/**
 * Reactivate a seat holder's sponsor access through `termEnd` WITHOUT
 * changing their tier — used when reinstating a sponsor. A VIP-ticket
 * holder (tier=vip) comes back as VIP (Basic-level), an admin-linked seat
 * as Pro, the owner as sponsor. Only when the person is a page rep and has
 * no prior sponsor row do we mint the owner's free membership.
 */
export async function reactivateSponsorMembership(
  profileId: string,
  termEnd: string,
  isRep: boolean,
): Promise<{ error: string | null }> {
  const admin = createServiceClient();
  // Latest sponsor-sourced row of ANY tier (including the expired one the
  // archive left behind) — reactivate it as-is.
  const { data: existing } = await admin
    .from("memberships")
    .select("id, tier")
    .eq("profile_id", profileId)
    .eq("source", "sponsor")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { error } = await admin
      .from("memberships")
      .update({ status: "active", access_expires_at: termEnd })
      .eq("id", existing.id);
    return { error: error?.message ?? null };
  }
  // No prior sponsor row. Only the page rep is owed a fresh free membership;
  // a seat with nothing to restore is left alone (its ticket was one-time).
  if (!isRep) return { error: null };
  return upsertSponsorMembership(profileId, termEnd, true);
}
