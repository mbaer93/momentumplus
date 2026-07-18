"use server";

import { emailPattern } from "@/lib/db-utils";
import { getStripeSettings, priceForTerm, stripeReady, stripeRequest } from "@/lib/stripe";
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
  /** Billing term in months: 1 (default), 3, 6, or 12 when configured. */
  months?: number;
  /** Referral code from /join?ref=… (falls back to the mp_ref cookie). */
  ref?: string;
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
    return {
      ok: false,
      existingAccount: true,
      message:
        "You already have a Momentum+ account. Log in and manage your plan from your Profile.",
    };
  }

  // Referral attribution: explicit param first, then the cookie set by
  // the middleware when they first landed with ?ref=.
  let ref = (input.ref ?? "").trim().toLowerCase().slice(0, 20);
  if (!ref) {
    const { cookies } = await import("next/headers");
    ref = (cookies().get("mp_ref")?.value ?? "").trim().toLowerCase().slice(0, 20);
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
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        success_url: `${site}/join?success=1`,
        cancel_url: `${site}/join?plan=${plan}&canceled=1`,
        "metadata[signup_email]": email,
        "metadata[signup_name]": name,
        "metadata[plan]": plan,
        ...(ref ? { "metadata[referral_code]": ref } : {}),
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
