import type { AccessLevel, Membership, Tier } from "./types";

// Tiers that satisfy the `vip_plus` gate (SPEC.md §2).
const VIP_PLUS_TIERS: Tier[] = ["tsls_vip", "sub_annual", "speaker", "admin"];

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

export function isMembershipActive(membership: Membership | null): boolean {
  if (!membership) return false;
  if (membership.status !== "active") return false;
  if (!membership.access_expires_at) return true; // ongoing (speaker/admin)
  return new Date(membership.access_expires_at).getTime() > Date.now();
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
    speaker: "Speaker",
    admin: "Administrator",
  };
  return map[tier];
}
