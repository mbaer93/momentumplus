import { PlansView } from "@/components/profile/PlansView";
import { isPro } from "@/lib/access";
import { requireMember } from "@/lib/current-member";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Plans & upgrades: the member-facing pricing page (linked from the avatar
 * menu, the rail upgrade card, and locked-content upsells). Side-by-side
 * benefits comparison with every configured billing term; upgrades check
 * out through Stripe, plan switches and cancellation go through the
 * customer portal (see PlansView).
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams?: { billing?: string };
}) {
  const member = await requireMember();
  const settings = await getStripeSettings();
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
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
      <PlansView
        enabled={stripeReady(settings)}
        terms={terms}
        stripePlan={stripePlan}
        isPro={isPro(member.tier)}
        hasCustomer={hasCustomer}
        tierLabel={member.tierLabel}
        billingNotice={searchParams?.billing === "unavailable"}
      />
    </div>
  );
}
