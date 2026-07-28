/*
 * Reading a Stripe event.
 *
 * These lived inside the webhook route, which made them unreachable from a
 * test: importing that module drags in NextRequest, the service-role client
 * and the env it needs. They are pure, they decide who keeps paid access, and
 * they are exactly the kind of thing a later "tidy-up" can quietly break — so
 * they live here, where they can be pinned down.
 *
 * The rule these encode, and the one worth not losing: access is extended on
 * `invoice.paid`, never on `customer.subscription.updated`. At renewal Stripe
 * advances current_period_end while the invoice is still unpaid and the
 * status is still "active", so extending on "updated" would hand a failed
 * card a free billing term.
 */

export interface StripeSubscriptionLike {
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
}

/**
 * When the paid period ends, as an ISO string.
 *
 * Stripe moved `current_period_end` onto the subscription *item* in the 2025
 * ("Basil") API versions and kept it top-level on older ones. The webhook
 * endpoint doesn't pin an api_version, so both shapes arrive in production
 * and both have to work.
 */
export function periodEndIso(sub: StripeSubscriptionLike): string | null {
  const unix =
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

/**
 * Stripe subscription status → our membership status.
 *
 * Anything unrecognised lands on past_due rather than active: an unknown
 * status is not evidence that someone has paid, and past_due still grants
 * the grace window instead of cutting access off immediately.
 */
export function mapStatus(
  stripeStatus: string,
): "active" | "past_due" | "canceled" {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") {
    return "canceled";
  }
  return "past_due";
}

export interface StripeInvoiceLike {
  subscription?: string | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
}

/**
 * Invoice → subscription id. Current ("Basil", 2025+) API versions moved it
 * under parent.subscription_details; older versions have it top-level.
 */
export function invoiceSubscriptionId(inv: StripeInvoiceLike): string | null {
  const sub = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  return typeof sub === "string" && sub ? sub : null;
}
