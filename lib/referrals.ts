import { createServiceClient } from "@/lib/supabase/admin";

/*
 * Member referrals: every member gets a code; /join?ref=CODE attributes the
 * signup; when the referred member's first payment lands (Stripe webhook),
 * the referrer earns a free month — as Stripe account credit equal to their
 * own plan price when they pay by card, otherwise as a one-month access
 * extension on their membership.
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
 * One month's worth of a subscription price, in the smallest currency unit.
 * A monthly price returns its full amount; a term price (interval=month,
 * count=N, or interval=year) is divided down to a single month so the
 * referral credit is always ~one month regardless of the referrer's term.
 */
export function oneMonthAmount(
  unitAmount: number,
  recurring?: { interval?: string; interval_count?: number } | null,
): number {
  const interval = recurring?.interval ?? "month";
  const count = Math.max(1, recurring?.interval_count ?? 1);
  const months =
    interval === "year"
      ? 12 * count
      : interval === "week"
        ? Math.max(1, Math.round((count * 7) / 30))
        : interval === "day"
          ? 1
          : count; // month
  return Math.round(unitAmount / Math.max(1, months));
}

/** One free month for the referrer: Stripe credit when they pay by card,
    otherwise a one-month access extension. Returns the reward kind. */
async function grantReferralReward(
  referrerProfileId: string,
): Promise<"stripe_credit" | "access_extended" | "none"> {
  const admin = createServiceClient();

  // Stripe path: credit their balance by one period of their own plan.
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", referrerProfileId)
      .maybeSingle();
    const customerId = profile?.stripe_customer_id as string | null;
    if (customerId) {
      const { getStripeSettings, stripeReady, stripeRequest } = await import(
        "@/lib/stripe"
      );
      const settings = await getStripeSettings();
      if (stripeReady(settings)) {
        const subs = await stripeRequest<{
          data: {
            items: {
              data: {
                price: {
                  unit_amount: number | null;
                  currency: string;
                  recurring?: { interval?: string; interval_count?: number } | null;
                };
              }[];
            };
          }[];
        }>(
          settings.secretKey,
          "GET",
          `/subscriptions?customer=${customerId}&status=active&limit=1`,
        );
        const price = subs.data?.[0]?.items?.data?.[0]?.price;
        if (price?.unit_amount) {
          // Credit exactly ONE MONTH — never the whole billing period. A
          // term price (3/6/12-month) has a unit_amount covering the full
          // term, so divide by how many months that term spans, or the
          // reward balloons to a full year for an annual subscriber.
          const monthly = oneMonthAmount(price.unit_amount, price.recurring);
          await stripeRequest(
            settings.secretKey,
            "POST",
            `/customers/${customerId}/balance_transactions`,
            {
              amount: -monthly,
              currency: price.currency || "usd",
              description: "Momentum+ referral reward — one free month",
            },
          );
          return "stripe_credit";
        }
      }
    }
  } catch {
    // fall through to the extension path
  }

  // Non-Stripe members (comps, imports): extend their expiry by a month.
  const { data: memberships } = await admin
    .from("memberships")
    .select("id, access_expires_at")
    .eq("profile_id", referrerProfileId)
    .eq("status", "active")
    .not("access_expires_at", "is", null)
    .order("access_expires_at", { ascending: false })
    .limit(1);
  const m = memberships?.[0];
  if (m?.access_expires_at) {
    const extended = new Date(m.access_expires_at as string);
    extended.setMonth(extended.getMonth() + 1);
    const { error } = await admin
      .from("memberships")
      .update({ access_expires_at: extended.toISOString() })
      .eq("id", m.id);
    if (!error) return "access_extended";
  }
  return "none";
}

/**
 * Called from the Stripe webhook when a referred signup's first payment
 * lands. Attribution is once-per-new-member (unique constraint) and never
 * self-referring; the reward + a bell notification go to the referrer.
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

    // Reward only referrers who currently hold access — a lapsed/canceled
    // account can't sit on a code and farm credits. Combined with the
    // one-month reward cap, this removes the "pay one cheap month, earn a
    // full term" economics.
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

    const reward = await grantReferralReward(referrer.id as string);
    await admin
      .from("referrals")
      .update({ reward })
      .eq("referred_profile_id", input.referredProfileId);

    await admin.from("notifications").insert({
      profile_id: referrer.id,
      kind: "platform",
      title: "Your referral joined — you earned a free month",
      body:
        reward === "stripe_credit"
          ? "A credit for one month of your plan was applied to your next bill. Thank you for growing the community."
          : reward === "access_extended"
            ? "Your membership access was extended by one month. Thank you for growing the community."
            : "Thank you for growing the community — the team will apply your reward.",
      link: "/profile",
    });
  } catch {
    // Referral bookkeeping must never break payment provisioning.
  }
}
