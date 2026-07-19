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
  // Public pricing surfaces read the same settings — bust them too so a
  // price change shows on the marketing/signup pages immediately.
  revalidatePath("/");
  revalidatePath("/join");
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

// ---------------------------------------------------------------------------
// One-stop pricing: set every plan/term at once.
// ---------------------------------------------------------------------------

export interface PlanPricing {
  /** Monthly price in dollars (required, > 0). */
  monthly: number;
  /** Total charged per term, in dollars, keyed by months. 0/absent = not
      offered (an existing term at that length is retired). */
  terms: Record<"3" | "6" | "12", number | null>;
}
export interface PricingInput {
  basic: PlanPricing;
  pro: PlanPricing;
}

const PLAN_PRODUCT_NAME: Record<"basic" | "pro", string> = {
  basic: "Momentum+ Member Membership",
  pro: "Momentum+ Pro Membership",
};

/**
 * Set all self-serve prices (Member + Pro, monthly and 3/6/12-month terms)
 * in one save. Stripe prices are IMMUTABLE, so a changed amount creates a
 * NEW price on the same product and archives the old one — existing
 * subscribers keep their price; new checkouts use the new one. Unchanged
 * cells are left alone; a cleared term is archived and removed.
 */
export async function saveAllPricing(
  input: PricingInput,
): Promise<BillingResult> {
  const early = await guardSuper();
  if (early) return early;
  const settings = await getStripeSettings();
  if (!settings?.secretKey) {
    return { ok: false, message: "Connect your Stripe key first." };
  }
  for (const plan of ["basic", "pro"] as const) {
    if (!(input[plan].monthly > 0)) {
      return {
        ok: false,
        message: `Enter a monthly price for ${plan === "basic" ? "Member" : "Pro"} (it anchors every term).`,
      };
    }
  }

  const key = settings.secretKey;
  const next: StripeSettings = {
    ...settings,
    prices: { ...settings.prices },
    productIds: { ...(settings.productIds ?? {}) },
    displayPrices: { ...(settings.displayPrices ?? {}) },
    termPrices: {
      basic: { ...(settings.termPrices?.basic ?? {}) },
      pro: { ...(settings.termPrices?.pro ?? {}) },
    },
    termDisplay: {
      basic: { ...(settings.termDisplay?.basic ?? {}) },
      pro: { ...(settings.termDisplay?.pro ?? {}) },
    },
  };

  // Stored ids belong to whichever mode created them. If the connected key
  // is now a different mode (live↔test), those ids don't resolve — treat
  // everything as absent and recreate in the current mode.
  const modeSwitched =
    settings.pricesLivemode !== undefined &&
    settings.pricesLivemode !== settings.livemode;

  // Archive a superseded price — best-effort, never fails the save. Skipped
  // across a mode switch (the old id lives in the other mode).
  const archive = async (priceId?: string | null) => {
    if (!priceId || modeSwitched) return;
    try {
      await stripeRequest(key, "POST", `/prices/${priceId}`, { active: false });
    } catch {
      /* leaving an old price active is harmless — checkout uses the new id */
    }
  };
  // Resolve (or create) the plan's Stripe product in the CURRENT mode.
  // Returns { product, fresh } — fresh=true means the old ids were unusable
  // (missing or wrong mode), so every price must be recreated.
  const ensureProduct = async (
    plan: "basic" | "pro",
  ): Promise<{ product: string; fresh: boolean }> => {
    if (!modeSwitched && next.productIds?.[plan]) {
      try {
        await stripeRequest(key, "GET", `/products/${next.productIds[plan]}`);
        return { product: next.productIds[plan] as string, fresh: false };
      } catch {
        /* stored product id doesn't resolve here — recreate below */
      }
    }
    if (!modeSwitched && settings.prices[plan]) {
      try {
        const p = await stripeRequest<{ product: string }>(
          key,
          "GET",
          `/prices/${settings.prices[plan]}`,
        );
        next.productIds![plan] = p.product;
        return { product: p.product, fresh: false };
      } catch {
        /* price id from another mode — recreate below */
      }
    }
    const product = await stripeRequest<{ id: string }>(key, "POST", "/products", {
      name: PLAN_PRODUCT_NAME[plan],
      "metadata[momentum_plan]": plan,
    });
    next.productIds![plan] = product.id;
    return { product: product.id, fresh: true };
  };

  const changes: string[] = [];
  try {
    for (const plan of ["basic", "pro"] as const) {
      const { product, fresh } = await ensureProduct(plan);
      const label = plan === "basic" ? "Member" : "Pro";

      // Monthly. Recreate when the amount changed OR the old ids are stale.
      const monthly = input[plan].monthly;
      if (fresh || !next.prices[plan] || next.displayPrices?.[plan] !== monthly) {
        const price = await stripeRequest<{ id: string }>(key, "POST", "/prices", {
          product,
          currency: "usd",
          unit_amount: Math.round(monthly * 100),
          "recurring[interval]": "month",
          "metadata[momentum_plan]": plan,
        });
        await archive(next.prices[plan]);
        next.prices[plan] = price.id;
        next.displayPrices![plan] = monthly;
        changes.push(`${label} monthly → $${monthly}/mo`);
      }

      // Terms.
      for (const m of ["3", "6", "12"] as const) {
        const total = input[plan].terms[m];
        const current = next.termDisplay?.[plan]?.[m];
        if (total && total > 0) {
          if (!fresh && current === total) continue;
          const price = await stripeRequest<{ id: string }>(key, "POST", "/prices", {
            product,
            currency: "usd",
            unit_amount: Math.round(total * 100),
            "recurring[interval]": "month",
            "recurring[interval_count]": Number(m),
            "metadata[momentum_plan]": plan,
            "metadata[momentum_months]": m,
          });
          await archive(next.termPrices?.[plan]?.[m]);
          next.termPrices![plan]![m] = price.id;
          next.termDisplay![plan]![m] = total;
          changes.push(`${label} ${m}-month → $${total}`);
        } else if (current != null) {
          await archive(next.termPrices?.[plan]?.[m]);
          delete next.termPrices![plan]![m];
          delete next.termDisplay![plan]![m];
          changes.push(`${label} ${m}-month removed`);
        }
      }
    }
    // Record the mode these ids now belong to.
    next.pricesLivemode = settings.livemode;
  } catch (e) {
    // Persist whatever succeeded so a mid-run failure isn't fully lost.
    await saveStripeSettings(next);
    refresh();
    return {
      ok: false,
      message: `Stripe error partway through: ${(e as Error).message}. Saved changes: ${changes.join(", ") || "none"}.`,
    };
  }

  await saveStripeSettings(next);
  refresh();
  return {
    ok: true,
    message: changes.length
      ? `Pricing saved — ${changes.join(", ")}.`
      : "No changes — prices already match.",
  };
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
