"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  getStripeSettings,
  saveStripeSettings,
  stripeRequest,
  type StripeSettings,
} from "@/lib/stripe";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface BillingResult {
  ok: boolean;
  message?: string;
}

/** Every billing-setup step is Super Admin territory. */
async function guardSuper(): Promise<BillingResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Connect Supabase before setting up billing." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return { ok: false, message: "Only the Super Admin can manage billing." };
  }
  return null;
}

function refresh() {
  revalidatePath("/admin/billing");
  revalidatePath("/profile");
  revalidatePath("/expired");
}

/** Step 1: validate the pasted secret key against Stripe and store it. */
export async function connectStripe(secretKey: string): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;

  const key = secretKey.trim();
  if (!/^(sk|rk)_(live|test)_/.test(key)) {
    return {
      ok: false,
      message:
        "That doesn't look like a Stripe secret key — it starts with sk_live_ or sk_test_. In Stripe: Developers → API keys → Secret key → Reveal.",
    };
  }

  try {
    const account = await stripeRequest<{
      id: string;
      email?: string;
      settings?: { dashboard?: { display_name?: string } };
      business_profile?: { name?: string };
    }>(key, "GET", "/account");

    const existing = await getStripeSettings();
    const settings: StripeSettings = {
      secretKey: key,
      accountName:
        account.settings?.dashboard?.display_name ??
        account.business_profile?.name ??
        account.email ??
        account.id,
      livemode: key.includes("_live_"),
      prices: existing?.prices ?? {},
      displayPrices: existing?.displayPrices,
      webhookSecret: existing?.webhookSecret,
      webhookEndpointId: existing?.webhookEndpointId,
      connectedAt: new Date().toISOString(),
    };
    await saveStripeSettings(settings);
    refresh();
    return { ok: true, message: `Connected to ${settings.accountName}.` };
  } catch (e) {
    return {
      ok: false,
      message: `Stripe rejected that key: ${(e as Error).message}. Double-check you copied the full Secret key.`,
    };
  }
}

/**
 * Step 2: create the two membership products in the connected Stripe account.
 * Prices are typed in by the Super Admin — never guessed.
 */
export async function createStripeProducts(
  basicUsd: number,
  proUsd: number,
): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;
  const settings = await getStripeSettings();
  if (!settings?.secretKey) {
    return { ok: false, message: "Connect your Stripe key first (Step 1)." };
  }
  if (!(basicUsd > 0) || !(proUsd > 0)) {
    return { ok: false, message: "Enter a monthly price (in dollars) for both plans." };
  }

  try {
    const plans: { plan: "basic" | "pro"; name: string; usd: number }[] = [
      { plan: "basic", name: "Momentum+ Basic Membership", usd: basicUsd },
      { plan: "pro", name: "Momentum+ Pro Membership", usd: proUsd },
    ];
    const prices: StripeSettings["prices"] = { ...settings.prices };
    for (const p of plans) {
      const product = await stripeRequest<{ id: string }>(
        settings.secretKey,
        "POST",
        "/products",
        { name: p.name, "metadata[momentum_plan]": p.plan },
      );
      const price = await stripeRequest<{ id: string }>(
        settings.secretKey,
        "POST",
        "/prices",
        {
          product: product.id,
          currency: "usd",
          unit_amount: Math.round(p.usd * 100),
          "recurring[interval]": "month",
          "metadata[momentum_plan]": p.plan,
        },
      );
      prices[p.plan] = price.id;
    }
    await saveStripeSettings({
      ...settings,
      prices,
      displayPrices: { basic: basicUsd, pro: proUsd },
    });
    refresh();
    return {
      ok: true,
      message: `Products created: Basic $${basicUsd}/mo and Pro $${proUsd}/mo.`,
    };
  } catch (e) {
    return { ok: false, message: `Stripe error: ${(e as Error).message}` };
  }
}

/**
 * Optional longer terms: creates 3/6/12-month prices (total charged per
 * term) on the existing products. Members then pick their term at checkout
 * and access always runs to the end of the paid term.
 */
export async function createTermPrices(input: {
  plan: "basic" | "pro";
  months: 3 | 6 | 12;
  totalUsd: number;
}): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;
  const settings = await getStripeSettings();
  const monthlyPriceId = settings?.prices[input.plan];
  if (!settings?.secretKey || !monthlyPriceId) {
    return { ok: false, message: "Create the monthly plans first (Step 2)." };
  }
  if (!(input.totalUsd > 0) || ![3, 6, 12].includes(input.months)) {
    return { ok: false, message: "Enter the total price for that term." };
  }
  try {
    const monthly = await stripeRequest<{ product: string }>(
      settings.secretKey,
      "GET",
      `/prices/${monthlyPriceId}`,
    );
    const price = await stripeRequest<{ id: string }>(
      settings.secretKey,
      "POST",
      "/prices",
      {
        product: monthly.product,
        currency: "usd",
        unit_amount: Math.round(input.totalUsd * 100),
        "recurring[interval]": "month",
        "recurring[interval_count]": input.months,
        "metadata[momentum_plan]": input.plan,
        "metadata[momentum_months]": input.months,
      },
    );
    const termPrices = { ...(settings.termPrices ?? {}) };
    termPrices[input.plan] = {
      ...(termPrices[input.plan] ?? {}),
      [String(input.months)]: price.id,
    };
    const termDisplay = { ...(settings.termDisplay ?? {}) };
    termDisplay[input.plan] = {
      ...(termDisplay[input.plan] ?? {}),
      [String(input.months)]: input.totalUsd,
    };
    await saveStripeSettings({ ...settings, termPrices, termDisplay });
    refresh();
    return {
      ok: true,
      message: `${input.months}-month ${input.plan} term created at $${input.totalUsd} per term.`,
    };
  } catch (e) {
    return { ok: false, message: `Stripe error: ${(e as Error).message}` };
  }
}

/** Step 3 (automatic): register our webhook endpoint in Stripe. */
export async function setupStripeWebhook(): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;
  const settings = await getStripeSettings();
  if (!settings?.secretKey) {
    return { ok: false, message: "Connect your Stripe key first (Step 1)." };
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl?.startsWith("https://")) {
    return {
      ok: false,
      message: "NEXT_PUBLIC_SITE_URL must be an https URL for Stripe webhooks.",
    };
  }

  try {
    const endpoint = await stripeRequest<{ id: string; secret: string }>(
      settings.secretKey,
      "POST",
      "/webhook_endpoints",
      {
        url: `${siteUrl}/api/webhooks/stripe`,
        "enabled_events[0]": "checkout.session.completed",
        "enabled_events[1]": "customer.subscription.updated",
        "enabled_events[2]": "customer.subscription.deleted",
        "enabled_events[3]": "invoice.payment_failed",
        "enabled_events[4]": "invoice.paid",
        "enabled_events[5]": "checkout.session.async_payment_succeeded",
        description: "Momentum+ membership sync",
      },
    );
    await saveStripeSettings({
      ...settings,
      webhookSecret: endpoint.secret,
      webhookEndpointId: endpoint.id,
    });
    refresh();
    return { ok: true, message: "Automatic updates are on — Stripe now syncs memberships." };
  } catch (e) {
    return { ok: false, message: `Stripe error: ${(e as Error).message}` };
  }
}

/** Step 3 (manual fallback): store a signing secret pasted from Stripe. */
export async function saveWebhookSecret(secret: string): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;
  const settings = await getStripeSettings();
  if (!settings?.secretKey) {
    return { ok: false, message: "Connect your Stripe key first (Step 1)." };
  }
  if (!secret.trim().startsWith("whsec_")) {
    return { ok: false, message: "Signing secrets start with whsec_ — copy it from the webhook's page in Stripe." };
  }
  await saveStripeSettings({ ...settings, webhookSecret: secret.trim() });
  refresh();
  return { ok: true, message: "Webhook signing secret saved." };
}
