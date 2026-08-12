import { createServiceClient } from "@/lib/supabase/admin";

/*
 * Member referrals: every member gets a code, /join?ref=CODE attributes the
 * signup, and that attribution is recorded when the referred member's first
 * payment lands (Stripe webhook). Bookkeeping only — who referred whom.
 *
 * THERE IS NO REWARD, AND NOTHING HERE MAY SPEND MONEY (Matt, 2026-08-12:
 * "there should be no real money being paid out to referrals").
 *
 * There used to be. grantReferralReward credited the referrer one month of
 * their own plan against their next Stripe invoice, or extended a comped
 * member's access_expires_at by a month. It never actually paid anybody —
 * production has neither the referrals table nor profiles.referral_code, so
 * attribution returned before reaching it — but the code shipped in every
 * deploy, which meant any future schema sync would have armed a payout path
 * silently. It is deleted rather than disabled: a dormant thing that spends
 * money is exactly what nearly went live here.
 *
 * If a referral reward is ever wanted, it is a pricing decision to agree
 * first and build second, not a function to un-comment.
 */

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/O/1/l/i

function randomCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** The member's referral code, minting one on first use. */
export async function ensureReferralCode(
  profileId: string,
): Promise<string | null> {
  const admin = createServiceClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("referral_code")
    .eq("id", profileId)
    .maybeSingle();
  if (error) return null; // pre-migration (0035)
  if (profile?.referral_code) return profile.referral_code as string;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error: writeError } = await admin
      .from("profiles")
      .update({ referral_code: code })
      .eq("id", profileId)
      .is("referral_code", null);
    if (!writeError) {
      const { data: after } = await admin
        .from("profiles")
        .select("referral_code")
        .eq("id", profileId)
        .maybeSingle();
      return (after?.referral_code as string) ?? code;
    }
    // Unique collision (1 in ~10^12) — try another code.
  }
  return null;
}

export async function getReferralCount(profileId: string): Promise<number> {
  const admin = createServiceClient();
  const { count, error } = await admin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_profile_id", profileId);
  return error ? 0 : (count ?? 0);
}

/**
 * Called from the Stripe webhook when a referred signup's first payment
 * lands. Attribution is once-per-new-member (unique constraint) and never
 * self-referring. It records who referred whom and tells the referrer their
 * referral joined — nothing is credited, extended, or owed.
 */
export async function attributeReferral(input: {
  referredProfileId: string;
  code: string;
}): Promise<void> {
  const code = input.code.trim().toLowerCase();
  if (!code) return;
  const admin = createServiceClient();
  try {
    const { data: referrer } = await admin
      .from("profiles")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (!referrer || referrer.id === input.referredProfileId) return;

    // Attribute only to referrers who currently hold access. This was
    // anti-farming logic when a reward existed; with no reward there is
    // nothing to farm, and it stays because crediting a lapsed account with
    // referrals it can't see is just a confusing record.
    const { data: refMemberships } = await admin
      .from("memberships")
      .select("status, access_expires_at")
      .eq("profile_id", referrer.id)
      .in("status", ["active", "past_due"]);
    const now = Date.now();
    const referrerHasAccess = (refMemberships ?? []).some((m) => {
      const exp = m.access_expires_at as string | null;
      return exp === null ? m.status === "active" : new Date(exp).getTime() > now;
    });
    if (!referrerHasAccess) return;

    const { error: insertError } = await admin.from("referrals").insert({
      referrer_profile_id: referrer.id,
      referred_profile_id: input.referredProfileId,
      code,
    });
    if (insertError) return; // duplicate attribution (or pre-migration)

    // No reward is granted and the `reward` column is left null. The
    // notice thanks them and promises nothing — a message implying a credit
    // that never arrives is worse than no message.
    await admin.from("notifications").insert({
      profile_id: referrer.id,
      kind: "platform",
      title: "Your referral joined",
      body: "Someone you referred just became a member. Thank you for growing the community.",
      link: "/profile",
    });
  } catch {
    // Referral bookkeeping must never break payment provisioning.
  }
}
