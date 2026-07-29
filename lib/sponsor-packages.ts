import type { SponsorTier } from "@/lib/sponsor-tiers";

/*
 * The 2026 TSLS package catalog — transcribed from Matt's official sheets
 * (2026 TSLS Sponsorship Opportunities, Media Partnership Opportunities;
 * uploaded 2026-07-29). This is reference data for the admin panel: prices,
 * how many of each package exist, and the headline benefits. The Dining
 * Partner tiers live on the TSLS app (restaurants), not here — those
 * businesses aren't sponsors, they're lunch stops.
 *
 * Media partnerships are IN-KIND: the "price" is the promotion value the
 * partner delivers in lieu of payment.
 */

export interface SponsorPackage {
  tier: SponsorTier;
  /** Package price in whole dollars (in-kind value for media partners). */
  price: number;
  /** True when the package is paid in promotion/trade, not cash. */
  inKind: boolean;
  /** How many can be sold — null means unlimited. */
  available: number | null;
  /** Marked sold out on the 2026 sheet. */
  soldOut?: boolean;
  /** Complimentary VIP tickets included (also the ticket-allotment default). */
  vipTickets: number;
  /** The benefits that sell the package, shortest first. */
  highlights: string[];
}

// Listed in the confirmed display hierarchy (lib/sponsor-tiers.ts), which
// is NOT price order — the 2026 sheet prices Lunch/Happy Hour above Gold.
export const SPONSOR_PACKAGES_2026: SponsorPackage[] = [
  {
    tier: "momentum_plus",
    price: 10000,
    inKind: false,
    available: 1,
    vipTickets: 2,
    highlights: [
      "Exclusive sponsorship of the Momentum+ program",
      "12 months of verbal recognition",
      "Back-cover ad in the Momentum+ guide",
      "Host two 1-hour (or one 2-hour) sessions · 4+ social posts",
    ],
  },
  {
    tier: "title",
    price: 15000,
    inKind: false,
    available: 1,
    vipTickets: 10,
    highlights: [
      "Opening acknowledgment + keynote introduction (up to 5 min)",
      "Full-page program ad · 3 swag items · 150 radio ads",
      "Premium booth · 6+ social posts",
      "Momentum+ session framing remarks + recognition at every session",
    ],
  },
  {
    tier: "platinum",
    price: 7500,
    inKind: false,
    available: 2,
    vipTickets: 5,
    highlights: [
      "Introduce a non-keynote speaker (30–60s)",
      "Half-page program ad · 2 swag items · 50 radio ads",
      "Shared digital slide with the Momentum+ sponsor",
    ],
  },
  {
    tier: "gold",
    price: 5000,
    inKind: false,
    available: 3,
    vipTickets: 5,
    highlights: [
      "Lobby booth",
      "Quarter-page program ad · 2 swag items",
      "Digital media only (no radio)",
    ],
  },
  {
    tier: "lunch",
    price: 6500,
    inKind: false,
    available: 1,
    vipTickets: 3,
    highlights: [
      "2–3 minute remarks at lunch",
      "Branded table signage + lunch tickets",
      "Quarter-page program ad · only ballroom exhibit at the VIP lunch",
    ],
  },
  {
    tier: "happy_hour",
    price: 6500,
    inKind: false,
    available: 1,
    vipTickets: 3,
    highlights: [
      "2–3 minutes on the mic at the happy hour",
      "Drink tickets + custom named cocktail/mocktail",
      "Quarter-page program ad",
    ],
  },
  {
    tier: "breakfast",
    price: 4000,
    inKind: false,
    available: 1,
    vipTickets: 2,
    highlights: [
      "Breakfast-area signage",
      "Quarter-page program ad · 2 swag items",
    ],
  },
  {
    tier: "silver",
    price: 2500,
    inKind: false,
    available: 3,
    vipTickets: 2,
    highlights: ["Lobby booth", "1 swag item"],
  },
  {
    tier: "coffee_break",
    price: 2500,
    inKind: false,
    available: 1,
    vipTickets: 2,
    highlights: [
      "Coffee-station signage",
      "Morning welcome recognition",
    ],
  },
  {
    tier: "event_program",
    price: 2500,
    inKind: false,
    available: 1,
    vipTickets: 2,
    highlights: [
      "Back-cover full-page ad",
      "“Event Program presented by…” on every page",
      "Booth · 1 swag item",
    ],
  },
  {
    tier: "community",
    price: 750,
    inKind: false,
    available: null,
    vipTickets: 1,
    highlights: [
      "Logo on the website + select materials",
      "Group rotating slide",
    ],
  },
  {
    tier: "strategic_media",
    price: 5000,
    inKind: true,
    available: 1,
    soldOut: true,
    vipTickets: 5,
    highlights: [
      "Optional booth · quarter-page program ad",
      "3 swag items · digital media (no radio)",
    ],
  },
  {
    tier: "regional_media",
    price: 2500,
    inKind: true,
    available: 2,
    vipTickets: 2,
    highlights: ["2 swag items"],
  },
  {
    tier: "community_media",
    price: 750,
    inKind: true,
    available: null,
    vipTickets: 1,
    highlights: ["1 swag item", "Group rotating slide"],
  },
];

export function packageForTier(tier: string): SponsorPackage | null {
  return SPONSOR_PACKAGES_2026.find((p) => p.tier === tier) ?? null;
}

/** "$6,500" — or "$5,000 in-kind" for media partners. */
export function packagePrice(p: SponsorPackage): string {
  const dollars = `$${p.price.toLocaleString("en-US")}`;
  return p.inKind ? `${dollars} in-kind` : dollars;
}

/**
 * Per-tier VIP ticket defaults from the 2026 sheets, in the shape the
 * ticket-allotment setting uses. Migration 0062 seeds these into
 * app_settings, keeping any counts the admin already set.
 */
export function defaultTicketCounts(): Record<string, number> {
  return Object.fromEntries(
    SPONSOR_PACKAGES_2026.map((p) => [p.tier, p.vipTickets]),
  );
}
