import { addMonths, TIER_PRECEDENCE } from "@/lib/membership";
import type { MembershipStatus, Tier } from "@/lib/types";

/*
 * TSLS Momentum+ gifts (Matt, 2026-07-29). Every summit attendee gets
 * Momentum+ free starting on event day — General = 1 month, VIP = 3 months
 * (the TSLS Companion bridge sends plan "gift"/"vip" once the on-stage
 * announcement flips).
 *
 * The wrinkle this module decides: what the gift means for someone who is
 * ALREADY a member. A free row underneath a paid subscription is a dead
 * gift — the member keeps paying straight through their "free" months. So:
 *
 *   - Stripe-billed member  → PAUSE collection for the gift length (Stripe
 *     resumes it by itself) and push their paid access out the same amount.
 *   - Billed elsewhere (GHL legacy) → we can't pause that billing from here;
 *     the gift months are added to the END of their membership instead.
 *   - Not a paying member → the normal gift membership row.
 *
 * Pure decisions live here (unit-tested); the Stripe call, the database
 * write and the member email live in lib/onboarding.ts where the grant
 * already happens.
 */

/** Free tiers a gift/comp grant can arrive as. */
export const GIFT_TIERS: readonly Tier[] = [
  "gift",
  "vip",
  "tsls_attendee",
  "tsls_vip",
];

/** Tiers someone actually pays for (Stripe plans + GHL legacy subs). */
export const PAID_TIERS: readonly Tier[] = [
  "basic",
  "pro",
  "sub_monthly",
  "sub_3mo",
  "sub_6mo",
  "sub_annual",
];

export function isGiftTier(tier: Tier): boolean {
  return GIFT_TIERS.includes(tier);
}

export function isPaidTier(tier: Tier): boolean {
  return PAID_TIERS.includes(tier);
}

/** The membership columns the gift decision reads. */
export interface BilledRow {
  id: string;
  tier: Tier;
  status: MembershipStatus;
  access_expires_at: string | null;
  source: string;
  stripe_subscription_id: string | null;
}

export type GiftPlan =
  | { kind: "pause"; row: BilledRow }
  | { kind: "extend"; row: BilledRow }
  | { kind: "grant" };

/**
 * What should this member's gift do? Only an ACTIVE, unexpired paid row
 * changes the answer — past_due members are mid-dunning (pausing a failing
 * subscription would hide the card problem) and canceled members have
 * already chosen to stop paying; both just get the normal gift row.
 */
export function giftPlanFor(
  rows: BilledRow[],
  now: number = Date.now(),
): GiftPlan {
  const paying = rows.filter(
    (r) =>
      isPaidTier(r.tier) &&
      r.status === "active" &&
      (!r.access_expires_at ||
        new Date(r.access_expires_at).getTime() > now),
  );
  if (paying.length === 0) return { kind: "grant" };
  paying.sort(
    (a, b) => TIER_PRECEDENCE.indexOf(a.tier) - TIER_PRECEDENCE.indexOf(b.tier),
  );
  const stripeBilled = paying.find(
    (r) => r.source === "stripe" && r.stripe_subscription_id,
  );
  if (stripeBilled) return { kind: "pause", row: stripeBilled };
  return { kind: "extend", row: paying[0] };
}

/**
 * Where paid access ends once the gift months are added: stacked on a
 * still-valid expiry, or restarted from now for a lapsed one (mirrors the
 * renewal math in applyGhlEvent).
 */
export function giftExtendedExpiry(
  currentExpiryIso: string | null,
  months: number,
  now: number = Date.now(),
): string {
  const current = currentExpiryIso ? new Date(currentExpiryIso).getTime() : null;
  const base = current && current > now ? current : now;
  return addMonths(new Date(base), months).toISOString();
}

/** Stripe pause_collection.resumes_at — unix seconds, gift months from now. */
export function pauseResumesAtUnix(
  months: number,
  now: number = Date.now(),
): number {
  return Math.floor(addMonths(new Date(now), months).getTime() / 1000);
}

/**
 * Gift start date off the bridge ("automatic when their ticket is purchased,
 * but the free months don't start until the month of the event" — Matt,
 * 2026-07-30). TSLS sends the first of the event month; anything unparseable
 * means "no scheduling — apply now".
 */
export function parseGiftStart(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = new Date(raw.trim()).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Schedule (true) or apply immediately (false)? */
export function isFutureStart(
  startIso: string | null,
  now: number = Date.now(),
): boolean {
  return Boolean(startIso && new Date(startIso).getTime() > now);
}

/** "November 14, 2026" — how dates read in the gift emails. */
export function giftDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
