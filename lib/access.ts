import type { AccessLevel, Membership, Tier } from "./types";
import type { AccessMatrix } from "./tiers";

// Tiers that satisfy the `vip_plus` gate (SPEC.md §2). Pro members get
// everything, so they clear this gate too. (The new `vip` level is a
// 3-month comp of Basic-level access — deliberately NOT vip_plus.)
const VIP_PLUS_TIERS: Tier[] = [
  "tsls_vip",
  "sub_annual",
  "speaker",
  "admin",
  "pro",
  "sponsor",
];

// Tiers that satisfy the `pro_only` gate (exclusive content toggle).
// Sponsors (the rep running a sponsor page) hold Pro-equivalent access.
const PRO_TIERS: Tier[] = ["pro", "admin", "sponsor"];

const ADMIN_TIERS: Tier[] = ["admin"];

/**
 * NOTE: These helpers mirror the DB-side gating for UI convenience only.
 * Access control is enforced server-side / in RLS (CLAUDE.md non-negotiable #1);
 * never rely on these client checks as the security boundary.
 */

export function isAdminTier(tier: Tier): boolean {
  return ADMIN_TIERS.includes(tier);
}

export function isVipPlus(tier: Tier): boolean {
  return VIP_PLUS_TIERS.includes(tier);
}

export function isPro(tier: Tier): boolean {
  return PRO_TIERS.includes(tier);
}

/**
 * Grace semantics (SPEC.md §4, mirrored in DB membership_grants_access()):
 * past_due (7-day grace) and canceled (until period end) keep access until
 * access_expires_at; only `active` may be ongoing with a null expiry.
 */
export function isMembershipActive(
  membership: Membership | null,
  now: number = Date.now(),
): boolean {
  if (!membership) return false;
  if (membership.status === "expired") return false;
  if (membership.access_expires_at === null) {
    return membership.status === "active";
  }
  return new Date(membership.access_expires_at).getTime() > now;
}

export function canAccess(
  tier: Tier,
  required: AccessLevel,
): boolean {
  switch (required) {
    case "all_members":
      return true;
    case "vip_plus":
      return isVipPlus(tier);
    case "pro_only":
      return isPro(tier);
    case "admin_only":
      return isAdminTier(tier);
    default:
      return false;
  }
}

// Human-readable tier label used in the sidebar / profile.
//
// Tiers are registry rows now (migration 0054 seeds "lite"; the Control Center
// creates tiers without a deploy), so the static map can't name every slug. If
// it misses, resolve the label from the access matrix; only if that also misses
// do we humanize the raw slug — never render a blank plan line.
export function tierLabel(tier: Tier, matrix?: AccessMatrix): string {
  const map: Record<Tier, string> = {
    tsls_attendee: "Summit Attendee",
    tsls_vip: "VIP Member",
    sub_3mo: "3-Month Member",
    sub_6mo: "6-Month Member",
    sub_monthly: "Monthly Member",
    sub_annual: "Annual Member",
    basic: "Momentum+ Member",
    gift: "Gift Member",
    vip: "VIP Access",
    pro: "Momentum+ Pro",
    sponsor: "Sponsor",
    speaker: "Speaker",
    admin: "Administrator",
  };
  const known = map[tier];
  if (known) return known;
  const fromRegistry = matrix?.tiers.find((t) => t.slug === tier)?.label;
  if (fromRegistry) return fromRegistry;
  return tier
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
