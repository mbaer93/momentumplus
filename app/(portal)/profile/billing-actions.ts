"use server";

import { getStripeSettings, stripeReady, stripeRequest } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface BillingActionResult {
  ok: boolean;
  url?: string;
  message?: string;
}

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL ?? "";

/**
 * Signed-in user (membership may be lapsed — renewals must work) + connected
 * Stripe, resolving/creating their Stripe customer.
 */
async function billingContext(): Promise<
  | { ok: true; userId: string; email: string; name: string; customerId: string | null; settings: NonNullable<Awaited<ReturnType<typeof getStripeSettings>>> }
  | { ok: false; message: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Billing activates once the site is connected." };
  }
  const settings = await getStripeSettings();
  if (!stripeReady(settings)) {
    return { ok: false, message: "Online billing isn't set up yet — contact the team." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const { data: profile } = await createServiceClient()
    .from("profiles")
    .select("full_name, email, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  return {
    ok: true,
    userId: user.id,
    email: profile?.email ?? user.email ?? "",
    name: profile?.full_name ?? "",
    customerId: profile?.stripe_customer_id ?? null,
    settings,
  };
}

async function ensureCustomer(
  ctx: Extract<Awaited<ReturnType<typeof billingContext>>, { ok: true }>,
): Promise<string> {
  if (ctx.customerId) return ctx.customerId;
  const customer = await stripeRequest<{ id: string }>(
    ctx.settings.secretKey,
    "POST",
    "/customers",
    {
      email: ctx.email,
      name: ctx.name || undefined,
      "metadata[profile_id]": ctx.userId,
    },
  );
  await createServiceClient()
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", ctx.userId);
  return customer.id;
}

/** Start a Stripe Checkout for Basic or Pro; returns the redirect URL. */
export async function startCheckout(
  plan: "basic" | "pro",
): Promise<BillingActionResult> {
  const ctx = await billingContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const price = ctx.settings.prices[plan];
  if (!price) return { ok: false, message: "That plan isn't available yet." };

  try {
    const customerId = await ensureCustomer(ctx);
    // One live subscription per member: switching plans happens in the
    // billing portal (prorated) — a second checkout would double-bill.
    // For a past-due member the portal is also where they fix their card,
    // so send them straight there instead of a dead-end message (a lapsed
    // member can't reach the /profile "Manage billing" button at all).
    const { data: liveSub } = await createServiceClient()
      .from("memberships")
      .select("id, status")
      .eq("profile_id", ctx.userId)
      .eq("source", "stripe")
      .in("status", ["active", "past_due"])
      .not("stripe_subscription_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (liveSub) {
      try {
        const portal = await stripeRequest<{ url: string }>(
          ctx.settings.secretKey,
          "POST",
          "/billing_portal/sessions",
          { customer: customerId, return_url: `${SITE()}/profile` },
        );
        return { ok: true, url: portal.url };
      } catch {
        return {
          ok: false,
          message:
            liveSub.status === "past_due"
              ? "Your subscription has a failed payment — contact support and we'll get your card updated."
              : "You already have a subscription — use Manage billing on your profile to switch plans (it prorates automatically).",
        };
      }
    }
    const session = await stripeRequest<{ url: string }>(
      ctx.settings.secretKey,
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        customer: customerId,
        "line_items[0][price]": price,
        "line_items[0][quantity]": 1,
        success_url: `${SITE()}/profile?billing=success`,
        cancel_url: `${SITE()}/profile?billing=canceled`,
        "metadata[profile_id]": ctx.userId,
        "metadata[plan]": plan,
        "subscription_data[metadata][profile_id]": ctx.userId,
        "subscription_data[metadata][plan]": plan,
        allow_promotion_codes: true,
      },
    );
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, message: `Couldn't start checkout: ${(e as Error).message}` };
  }
}

/** Open the Stripe customer portal (update card, switch plan, cancel). */
export async function openBillingPortal(): Promise<BillingActionResult> {
  const ctx = await billingContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (!ctx.customerId) {
    return {
      ok: false,
      message: "No billing profile yet — subscribe to a plan first.",
    };
  }
  try {
    const session = await stripeRequest<{ url: string }>(
      ctx.settings.secretKey,
      "POST",
      "/billing_portal/sessions",
      { customer: ctx.customerId, return_url: `${SITE()}/profile` },
    );
    return { ok: true, url: session.url };
  } catch (e) {
    return {
      ok: false,
      message: `Couldn't open the billing portal: ${(e as Error).message}. (The Super Admin may need to enable the Customer portal in Stripe → Settings → Billing.)`,
    };
  }
}
