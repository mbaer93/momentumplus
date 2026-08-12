"use server";

import { emailPattern } from "@/lib/db-utils";
import { getStripeSettings, priceForTerm, stripeReady, stripeRequest } from "@/lib/stripe";
import { getAccessMatrix, publicTiers } from "@/lib/tiers";
import { requestSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Public signup → Stripe Checkout. No account needed up front: the visitor
 * pays first, then the Stripe webhook provisions their account (invite email
 * lands them on /welcome to set a password). Existing emails are sent to
 * login instead — one account per email, always.
 */

export interface JoinResult {
  ok: boolean;
  url?: string;
  message?: string;
  /** Show a "Log in" link with the message. Deliberately NOT named or
      worded as "account exists" — see the enumeration note below. */
  tryLogin?: boolean;
}

export async function startPublicCheckout(input: {
  plan: "basic" | "pro";
  email: string;
  name: string;
  /** Billing term in months: 1 (default), 3, 6, or 12 when configured. */
  months?: number;
}): Promise<JoinResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const plan = input.plan === "pro" ? "pro" : "basic";
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  // The real gate on an unlaunched tier. Hiding the card is presentation;
  // this is what stops a hand-built request buying Pro before it ships.
  const liveSlugs = new Set(publicTiers(await getAccessMatrix()).map((t) => t.slug));
  if (!liveSlugs.has(plan)) {
    return {
      ok: false,
      message: "That membership isn't on sale yet.",
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Signup opens once the site is fully connected." };
  }
  const months = [1, 3, 6, 12].includes(input.months ?? 1) ? (input.months ?? 1) : 1;
  const settings = await getStripeSettings();
  const priceId = settings ? priceForTerm(settings, plan, months) : null;
  if (!stripeReady(settings) || !priceId) {
    return {
      ok: false,
      message:
        "Online signup isn't open quite yet — email the TSLS team and we'll get you set up.",
    };
  }

  // One account per email: existing members subscribe from their profile.
  const { data: existing } = await createServiceClient()
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(email))
    .maybeSingle();
  if (existing) {
    // Neutral copy (audit P1-12): the old "You already have an account"
    // reply was a yes/no oracle for whether any email is registered here.
    // One account per email still blocks the checkout, but the response no
    // longer CONFIRMS the account exists — it reads the same as any
    // can't-proceed state and offers login as one path forward.
    return {
      ok: false,
      tryLogin: true,
      message:
        "We couldn't start checkout with that email. If you already have a Momentum+ account, log in and manage your plan from your Profile; otherwise contact the TSLS team and we'll get you set up.",
    };
  }

  const site = await requestSiteUrl() ?? "";
  try {
    const session = await stripeRequest<{ url: string }>(
      settings.secretKey,
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        customer_email: email,
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        success_url: `${site}/join?success=1`,
        cancel_url: `${site}/join?plan=${plan}&canceled=1`,
        "metadata[signup_email]": email,
        "metadata[signup_name]": name,
        "metadata[plan]": plan,
        "subscription_data[metadata][plan]": plan,
        // Session metadata dies with the checkout session; the SUBSCRIPTION
        // carries this email for the life of the plan so the webhook's
        // missed-checkout heal can find the member even when the
        // checkout.session.completed event itself was lost (audit P1-8).
        "subscription_data[metadata][signup_email]": email,
        allow_promotion_codes: true,
      },
    );
    return { ok: true, url: session.url };
  } catch (e) {
    return {
      ok: false,
      message: `Couldn't start checkout: ${(e as Error).message}`,
    };
  }
}
