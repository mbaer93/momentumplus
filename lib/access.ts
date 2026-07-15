import type { AccessLevel, Membership, Tier } from "./types";

// Tiers that satisfy the `vip_plus` gate (SPEC.md §2). Pro members get
// everything, so they clear this gate too. (The new `vip` level is a
// 3-month comp of Basic-level access — deliberately NOT vip_plus.)
const VIP_PLUS_TIERS: Tier[] = ["tsls_vip", "sub_annual", "speaker", "admin", "pro"];

// Tiers that satisfy the `pro_only` gate (exclusive content toggle).
const PRO_TIERS: Tier[] = ["pro", "admin"];

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
export function tierLabel(tier: Tier): string {
  const map: Record<Tier, string> = {
    tsls_attendee: "Summit Attendee",
    tsls_vip: "VIP Member",
    sub_3mo: "3-Month Member",
    sub_6mo: "6-Month Member",
    sub_monthly: "Monthly Member",
    sub_annual: "Annual Member",
    basic: "Basic Member",
    gift: "Gift Member",
    vip: "VIP Member",
    pro: "Pro Member",
    speaker: "Speaker",
    admin: "Administrator",
  };
  return map[tier];
}
