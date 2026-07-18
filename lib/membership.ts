import type { Membership, MembershipStatus, Tier } from "./types";

/*
 * Membership domain logic (SPEC.md §2, §4). Pure and clock-injectable so the
 * GHL webhook / TSLS import behavior is unit-testable without a database.
 * GHL is the source of truth for payment status (CLAUDE.md non-negotiable #2).
 */

export const GRACE_DAYS = 7;

// Most → least privileged. Used to pick the "effective" membership when a
// member holds several rows (e.g. TSLS import + later subscription).
export const TIER_PRECEDENCE: Tier[] = [
  "admin",
  "pro",
  "sponsor",
  "speaker",
  "sub_annual",
  "tsls_vip",
  "sub_6mo",
  "sub_3mo",
  "sub_monthly",
  "basic",
  "vip",
  "gift",
  "tsls_attendee",
];

// Paid duration per tier in months (SPEC.md §2). null = ongoing (no expiry).
// sub_monthly is rolling: each successful payment extends by one month.
// tsls_attendee duration comes from the registration type, not the tier.
export function tierDurationMonths(tier: Tier): number | null {
  switch (tier) {
    case "sub_monthly":
    case "basic": // Stripe-billed monthly; the webhook extends per period
    case "pro": // Stripe-billed monthly; the webhook extends per period
    case "gift": // free Basic-level access for 1 month
      return 1;
    case "sub_3mo":
    case "tsls_vip":
    case "vip": // free Basic-level access for 3 months
      return 3;
    case "sub_6mo":
      return 6;
    case "sub_annual":
      return 12;
    case "sponsor": // season-bound; the sponsor flows set expiry explicitly
    case "speaker":
    case "admin":
      return null;
    case "tsls_attendee":
      return null; // caller supplies months from the registration type
  }
}

/** Calendar-month addition with end-of-month clamping (Jan 31 +1mo → Feb 28). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDay, daysInTarget));
  return d;
}

/**
 * Does this membership currently grant portal access?
 * - active: until expiry (or indefinitely when expiry is null — speaker/admin)
 * - past_due: 7-day grace — access continues until access_expires_at
 * - canceled: access until period end (access_expires_at)
 * - expired: never
 */
export function hasAccess(
  membership: Pick<Membership, "status" | "access_expires_at"> | null,
  now: number = Date.now(),
): boolean {
  if (!membership) return false;
  const { status, access_expires_at } = membership;
  if (status === "expired") return false;
  if (access_expires_at === null) return status === "active";
  return new Date(access_expires_at).getTime() > now;
}

/** Pick the most privileged membership that still grants access. */
export function effectiveMembership<T extends Pick<Membership, "tier" | "status" | "access_expires_at">>(
  memberships: T[],
  now: number = Date.now(),
): T | null {
  const usable = memberships.filter((m) => hasAccess(m, now));
  if (usable.length === 0) return null;
  return usable.sort(
    (a, b) => TIER_PRECEDENCE.indexOf(a.tier) - TIER_PRECEDENCE.indexOf(b.tier),
  )[0];
}

// ---------------------------------------------------------------------------
// GHL webhook events
// ---------------------------------------------------------------------------

export type GhlEventKind = "payment_success" | "payment_failed" | "cancel";

export interface GhlEvent {
  kind: GhlEventKind;
  contactId: string;
  email: string;
  fullName?: string;
  /** GHL product identifier — mapped to a tier via GHL_PRODUCT_TIER_MAP. */
  productId?: string;
  /** Explicit tier override (useful for test events / manual workflows). */
  tier?: Tier;
}

const KIND_ALIASES: Record<string, GhlEventKind> = {
  payment_success: "payment_success",
  "payment.succeeded": "payment_success",
  invoicepaid: "payment_success",
  orderpaid: "payment_success",
  payment_failed: "payment_failed",
  "payment.failed": "payment_failed",
  invoicefailed: "payment_failed",
  cancel: "cancel",
  canceled: "cancel",
  cancelled: "cancel",
  subscription_cancelled: "cancel",
  "subscription.canceled": "cancel",
};

const SUB_TIERS: Tier[] = ["sub_3mo", "sub_6mo", "sub_monthly", "sub_annual"];

/**
 * Normalize a raw webhook payload (our documented contract, tolerant of GHL
 * event-name variants) into a GhlEvent. Returns null when it isn't one of ours.
 */
export function normalizeGhlEvent(payload: unknown): GhlEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const rawKind = String(p.type ?? p.event ?? "").toLowerCase();
  const kind = KIND_ALIASES[rawKind];
  const contactId = String(p.contactId ?? p.contact_id ?? "");
  const email = String(p.email ?? p.contactEmail ?? "").trim().toLowerCase();
  if (!kind || !email) return null;

  const tierRaw = typeof p.tier === "string" ? (p.tier as Tier) : undefined;
  return {
    kind,
    contactId,
    email,
    fullName:
      typeof p.fullName === "string"
        ? p.fullName
        : typeof p.name === "string"
          ? p.name
          : undefined,
    productId:
      typeof p.productId === "string"
        ? p.productId
        : typeof p.product_id === "string"
          ? p.product_id
          : undefined,
    tier: tierRaw && SUB_TIERS.includes(tierRaw) ? tierRaw : undefined,
  };
}

/** Map a GHL product id to a tier using the JSON env map. Unmapped → null. */
export function resolveTier(
  event: Pick<GhlEvent, "productId" | "tier">,
  productMapJson: string | undefined,
): Tier | null {
  if (event.tier) return event.tier;
  if (!event.productId || !productMapJson) return null;
  try {
    const map = JSON.parse(productMapJson) as Record<string, string>;
    const tier = map[event.productId];
    return tier && SUB_TIERS.includes(tier as Tier) ? (tier as Tier) : null;
  } catch {
    return null;
  }
}

export interface MembershipPatch {
  tier: Tier;
  status: MembershipStatus;
  access_starts_at: string | null;
  access_expires_at: string | null;
  ghl_contact_id: string | null;
  source: "ghl";
}

/**
 * Compute the membership row that should exist after applying a GHL event to
 * the member's current GHL-sourced membership (or null for a first purchase).
 *
 * - payment_success: activate; extend expiry by the tier's duration from
 *   max(now, current expiry) so early renewals stack, lapsed ones restart.
 * - payment_failed: past_due with a 7-day grace window (never shortens a
 *   still-valid paid period).
 * - cancel: canceled, access until the already-paid period end.
 */
export function applyGhlEvent(
  event: GhlEvent,
  tier: Tier,
  existing: Pick<
    Membership,
    "tier" | "status" | "access_starts_at" | "access_expires_at"
  > | null,
  now: number = Date.now(),
): MembershipPatch {
  const nowIso = new Date(now).toISOString();
  const currentExpiry = existing?.access_expires_at
    ? new Date(existing.access_expires_at).getTime()
    : null;

  switch (event.kind) {
    case "payment_success": {
      const months = tierDurationMonths(tier) ?? 1;
      const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
      return {
        tier,
        status: "active",
        access_starts_at: existing?.access_starts_at ?? nowIso,
        access_expires_at: addMonths(new Date(base), months).toISOString(),
        ghl_contact_id: event.contactId || null,
        source: "ghl",
      };
    }
    case "payment_failed": {
      const grace = now + GRACE_DAYS * 24 * 60 * 60 * 1000;
      const expires = Math.max(currentExpiry ?? 0, grace);
      return {
        tier: existing?.tier ?? tier,
        status: "past_due",
        access_starts_at: existing?.access_starts_at ?? nowIso,
        access_expires_at: new Date(expires).toISOString(),
        ghl_contact_id: event.contactId || null,
        source: "ghl",
      };
    }
    case "cancel": {
      return {
        tier: existing?.tier ?? tier,
        status: "canceled",
        access_starts_at: existing?.access_starts_at ?? nowIso,
        // Access runs until the already-paid period end; if unknown, ends now.
        access_expires_at: existing?.access_expires_at ?? nowIso,
        ghl_contact_id: event.contactId || null,
        source: "ghl",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// TSLS registration import
// ---------------------------------------------------------------------------

export interface TslsMapping {
  tier: Tier;
  months: number;
}

/**
 * Map a registration type to tier + months. VIP is spec-fixed (tsls_vip,
 * 3 months). Every other type must be present in TSLS_TYPE_MAP — unmapped
 * types are skipped and reported rather than guessed (tier rules are Matt's
 * call, per CLAUDE.md "When unsure").
 */
export function mapTslsRegistration(
  registrationType: string,
  typeMapJson: string | undefined,
): TslsMapping | null {
  const type = registrationType.trim().toLowerCase();
  if (!type) return null;

  if (typeMapJson) {
    try {
      const map = JSON.parse(typeMapJson) as Record<
        string,
        { tier: string; months: number }
      >;
      const hit = map[type];
      if (
        hit &&
        (hit.tier === "tsls_attendee" || hit.tier === "tsls_vip") &&
        Number.isFinite(hit.months) &&
        hit.months > 0
      ) {
        return { tier: hit.tier as Tier, months: hit.months };
      }
    } catch {
      // fall through to the VIP default
    }
  }

  if (type.includes("vip")) return { tier: "tsls_vip", months: 3 };
  return null;
}
