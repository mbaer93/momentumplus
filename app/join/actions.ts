"use server";

import { getStripeSettings, stripeReady, stripeRequest } from "@/lib/stripe";
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
  existingAccount?: boolean;
}

export async function startPublicCheckout(input: {
  plan: "basic" | "pro";
  email: string;
  name: string;
}): Promise<JoinResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const plan = input.plan === "pro" ? "pro" : "basic";
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Signup opens once the site is fully connected." };
  }
  const settings = await getStripeSettings();
  if (!stripeReady(settings) || !settings.prices[plan]) {
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
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      existingAccount: true,
      message:
        "You already have a Momentum+ account. Log in and manage your plan from your Profile.",
    };
  }

  const site = requestSiteUrl() ?? "";
  try {
    const session = await stripeRequest<{ url: string }>(
      settings.secretKey,
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        customer_email: email,
        "line_items[0][price]": settings.prices[plan]!,
        "line_items[0][quantity]": 1,
        success_url: `${site}/join?success=1`,
        cancel_url: `${site}/join?plan=${plan}&canceled=1`,
        "metadata[signup_email]": email,
        "metadata[signup_name]": name,
        "metadata[plan]": plan,
        "subscription_data[metadata][plan]": plan,
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
