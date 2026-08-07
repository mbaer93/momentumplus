import { PlansView } from "@/components/profile/PlansView";
import { isPro } from "@/lib/access";
import { requireMember } from "@/lib/current-member";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { getAccessMatrix, upgradeTierFor } from "@/lib/tiers";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Plans & upgrades: the member-facing pricing page (linked from the avatar
 * menu, the rail upgrade card, and locked-content upsells). Side-by-side
 * benefits comparison with every configured billing term; upgrades check
 * out through Stripe, plan switches and cancellation go through the
 * customer portal (see PlansView).
 */
export default async function UpgradePage(
  props: {
    searchParams?: Promise<{ billing?: string; feature?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const member = await requireMember();
  const settings = await getStripeSettings();

  // Arrived from a padlock: name the feature they reached for, and the
  // cheapest tier that would open it. If no tier ON SALE includes it, say so
  // plainly rather than dangling an upgrade they can't buy yet.
  const matrix = await getAccessMatrix();
  const wanted = searchParams?.feature
    ? (matrix.features.find((f) => f.key === searchParams.feature) ?? null)
    : null;
  const unlockedBy = wanted ? upgradeTierFor(matrix, wanted.key) : null;
  const terms = {
    basic: {
      1: settings?.displayPrices?.basic ?? null,
      ...(settings?.termDisplay?.basic ?? {}),
    },
    pro: {
      1: settings?.displayPrices?.pro ?? null,
      ...(settings?.termDisplay?.pro ?? {}),
    },
  };

  // The viewer's live Stripe subscription (if any) decides what each plan
  // card's button does — subscribe, prorated switch, or "current plan".
  let stripePlan: "basic" | "pro" | null = null;
  let hasCustomer = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const user = await getAuthUser();
    if (user) {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase
          .from("profiles")
          .select("stripe_customer_id")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("tier")
          .eq("profile_id", user.id)
          .eq("source", "stripe")
          .in("status", ["active", "past_due"])
          .limit(1)
          .maybeSingle(),
      ]);
      hasCustomer = Boolean(profile?.stripe_customer_id);
      if (sub) stripePlan = sub.tier === "pro" ? "pro" : "basic";
    }
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Plans &amp; Upgrades</h2>
          <p>
            Compare levels, upgrade, switch plans, or manage billing — you&apos;re
            currently on <strong>{member.tierLabel}</strong>.
          </p>
        </div>
      </div>
      {wanted && (
        <div className="upgrade-callout">
          <strong>{wanted.label}</strong>{" "}
          {!wanted.isLaunched ? (
            <>isn&apos;t available yet — it&apos;ll open to members soon. No plan
            unlocks it just yet.</>
          ) : unlockedBy ? (
            <>
              isn&apos;t part of {member.tierLabel}. It&apos;s included with{" "}
              <strong>{unlockedBy.label}</strong>.
            </>
          ) : (
            <>isn&apos;t part of {member.tierLabel} yet — it&apos;s not on sale
            at the moment. We&apos;ll announce it when it opens up.</>
          )}
        </div>
      )}
      <PlansView
        enabled={stripeReady(settings)}
        terms={terms}
        stripePlan={stripePlan}
        isPro={isPro(member.tier)}
        // Stripe subscribers are handled by stripePlan; this guards everyone
        // else whose access is already covered (comp, GHL, import).
        hasActiveMembership={member.membershipActive && !stripePlan}
        hasCustomer={hasCustomer}
        tierLabel={member.tierLabel}
        billingNotice={searchParams?.billing === "unavailable"}
      />
    </div>
  );
}
