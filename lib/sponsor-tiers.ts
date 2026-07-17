/*
 * Sponsor tier hierarchy (Matt, 2026-07-17) — top tier first. The Momentum+
 * Sponsor is the platform's own headline sponsor ("Presented by" slot);
 * everything below mirrors the TSLS sponsorship packages; Partner is the
 * bottom (trade/media) tier. Order here is the display order everywhere.
 */

export const SPONSOR_TIERS = [
  { value: "momentum_plus", label: "Momentum+ Sponsor" },
  { value: "title", label: "Title Sponsor" },
  { value: "platinum", label: "Platinum Sponsor" },
  { value: "gold", label: "Gold Sponsor" },
  { value: "lunch", label: "Lunch Sponsor" },
  { value: "happy_hour", label: "Networking Happy Hour Sponsor" },
  { value: "breakfast", label: "Breakfast Sponsor" },
  { value: "silver", label: "Silver Sponsor" },
  { value: "coffee_break", label: "Coffee Break Sponsor" },
  { value: "community", label: "Community Sponsor" },
  { value: "partner", label: "Partner" },
] as const;

export type SponsorTier = (typeof SPONSOR_TIERS)[number]["value"];

const RANK = new Map<string, number>(
  SPONSOR_TIERS.map((t, i) => [t.value, i]),
);
const LABEL = new Map<string, string>(
  SPONSOR_TIERS.map((t) => [t.value, t.label]),
);

/** Display rank — lower is more prominent; unknown values sink to the end. */
export function sponsorTierRank(tier: string): number {
  return RANK.get(tier) ?? SPONSOR_TIERS.length;
}

export function sponsorTierLabel(tier: string): string {
  return LABEL.get(tier) ?? tier;
}

/** Normalize arbitrary stored values (incl. pre-hierarchy rows) to a tier. */
export function normalizeSponsorTier(tier: string): SponsorTier {
  return RANK.has(tier) ? (tier as SponsorTier) : "partner";
}
