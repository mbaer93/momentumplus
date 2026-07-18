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
  // new `sponsor` rows and pre-migration `pro` fallback rows.
  const { data: existing, error: lookupError } = await admin
    .from("memberships")
    .select("id, tier")
    .eq("profile_id", profileId)
    .eq("source", "sponsor")
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
