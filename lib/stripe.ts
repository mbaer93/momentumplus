import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";

/*
 * Stripe integration (billing lives with Sierra's Stripe account, connected
 * through the Admin → Billing wizard — no code or env changes needed):
 *   - settings (secret key, price ids, webhook secret) live in app_settings,
 *     readable only via the service role
 *   - REST calls go straight to api.stripe.com with form-encoded bodies,
 *     so no SDK dependency
 *   - webhook signatures are verified with the stored signing secret
 */

const STRIPE_API = "https://api.stripe.com/v1";
export const STRIPE_SETTINGS_KEY = "stripe";

export interface StripeSettings {
  secretKey: string;
  accountName: string;
  livemode: boolean;
  /** Stripe price ids per self-serve plan. */
  prices: { basic?: string; pro?: string };
  /** Stripe product ids per plan (so term prices attach without a lookup). */
  productIds?: { basic?: string; pro?: string };
  /** Display prices (USD/month) captured when the products were created. */
  displayPrices?: { basic?: number; pro?: number };
  /** Optional longer billing terms: Stripe price ids keyed by months (3/6/12). */
  termPrices?: { basic?: Record<string, string>; pro?: Record<string, string> };
  /** Term totals in USD keyed the same way (for display). */
  termDisplay?: { basic?: Record<string, number>; pro?: Record<string, number> };
  webhookSecret?: string;
  webhookEndpointId?: string;
  connectedAt: string;
}

/* requestCache(): read once per request (layout, pages, and actions all ask). */
export const getStripeSettings = requestCache(
  async (): Promise<StripeSettings | null> => {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const { data } = await createServiceClient()
    .from("app_settings")
    .select("value")
    .eq("key", STRIPE_SETTINGS_KEY)
    .maybeSingle();
  return (data?.value as StripeSettings | undefined) ?? null;
});

export async function saveStripeSettings(value: StripeSettings): Promise<void> {
  await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: STRIPE_SETTINGS_KEY, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/** True once Sierra's wizard has stored a key + both prices + webhook secret. */
export function stripeReady(s: StripeSettings | null): s is StripeSettings {
  return Boolean(s?.secretKey && s.prices.basic && s.prices.pro && s.webhookSecret);
}

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

type Params = Record<string, string | number | boolean | undefined>;

function encodeForm(params: Params): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

export async function stripeRequest<T = Record<string, unknown>>(
  secretKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Params,
): Promise<T> {
  const body = params && method !== "GET" ? encodeForm(params) : undefined;
  const qs = params && method === "GET" ? `?${encodeForm(params)}` : "";
  const res = await fetch(`${STRIPE_API}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    cache: "no-store",
  });
  const json = (await res.json()) as T & {
    error?: { message?: string; type?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe error (${res.status})`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Stripe-Signature: t=...,v1=...)
// ---------------------------------------------------------------------------

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  signingSecret: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
  if (!signatureHeader) return false;
  const parts = new Map(
    signatureHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1)] as const;
    }),
  );
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) return false;

  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > tolerance) return false;

  const expected = createHmac("sha256", signingSecret)
    .update(`${t}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The Stripe price id for a plan at a billing term (1/3/6/12 months). */
export function priceForTerm(
  s: StripeSettings,
  plan: "basic" | "pro",
  months: number,
): string | null {
  if (months === 1) return s.prices[plan] ?? null;
  return s.termPrices?.[plan]?.[String(months)] ?? null;
}

/** Reverse lookup: which plan does a Stripe price id belong to? */
export function planForPrice(
  s: StripeSettings,
  priceId: string,
): "basic" | "pro" | null {
  for (const plan of ["basic", "pro"] as const) {
    if (s.prices[plan] === priceId) return plan;
    const terms = s.termPrices?.[plan] ?? {};
    if (Object.values(terms).includes(priceId)) return plan;
  }
  return null;
}
