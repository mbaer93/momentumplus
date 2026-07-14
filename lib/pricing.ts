import type { Tier } from "./types";

/*
 * Confirmed membership pricing (SPEC.md §2 — display exactly as listed).
 * These strings are copy, not math: show per-month equivalents and savings
 * verbatim on pricing/renewal pages.
 */

export interface PricingPlan {
  tier: Tier;
  name: string;
  price: string;
  perMonth: string;
  savings: string | null;
  blurb: string;
  bestValue: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    tier: "sub_monthly",
    name: "Monthly",
    price: "$198/mo",
    perMonth: "$198/mo",
    savings: null,
    blurb: "Flexible monthly access",
    bestValue: false,
  },
  {
    tier: "sub_3mo",
    name: "3-Month",
    price: "$534",
    perMonth: "$178/mo",
    savings: "Save $60",
    blurb: "Designed for leaders committed to implementation momentum",
    bestValue: false,
  },
  {
    tier: "sub_6mo",
    name: "6-Month",
    price: "$948",
    perMonth: "$158/mo",
    savings: "Save $240",
    blurb: "For leaders serious about sustained growth and accountability",
    bestValue: false,
  },
  {
    tier: "sub_annual",
    name: "12-Month",
    price: "$1,668",
    perMonth: "$139/mo",
    savings: "Save $708",
    blurb: "The full leadership ecosystem experience",
    bestValue: true, // flag as Best Value in UI (aligns with annual TSLS cycle)
  },
];

// Referenced on the VIP-sourced welcome experience (SPEC.md §2).
export const VIP_INCLUDED_NOTE =
  "Your VIP Summit registration includes 3 months of Momentum+ (a $534 value).";
