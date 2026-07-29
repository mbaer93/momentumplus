/*
 * The parts of the ad manager that both the server and the browser need:
 * the shapes, the seeded placement list, and the on-air test.
 *
 * Split out of lib/ads.ts because that module reaches for the server-side
 * Supabase client, and the admin manager is a client component — importing
 * the reader there dragged server-only code into the browser bundle.
 */

export interface AdPlacement {
  key: string;
  label: string;
  description: string;
  sort: number;
}

export interface AdCreative {
  id: string;
  placementKey: string;
  kind: "ad" | "notice";
  title: string;
  body: string;
  ctaLabel: string;
  url: string;
  imageUrl: string | null;
  sponsorId: string | null;
  sort: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Member-type slugs that see this creative. Empty = every member. */
  tiers: string[];
}

/* Mirrors the seed in 0056 so the manager renders before the migration runs. */
export const FALLBACK_PLACEMENTS: AdPlacement[] = [
  {
    key: "rail",
    label: "Right-hand rail",
    description: "The sponsor column beside the main content. Desktop only.",
    sort: 10,
  },
  {
    key: "body_banner",
    label: "In-page banner",
    description:
      "Full-width strip inside the page body — dashboard and list pages.",
    sort: 20,
  },
  {
    key: "body_tile",
    label: "In-page tile",
    description: "Compact card sized for grid pages.",
    sort: 30,
  },
  {
    key: "dashboard_top",
    label: "Dashboard notice",
    description:
      "Above the fold on the member dashboard. Best for house notices.",
    sort: 40,
  },
];

/** Is a creative on air right now? Drives the status pill in the manager. */
export function adStatus(a: AdCreative, now: Date = new Date()): {
  label: string;
  tone: "live" | "draft" | "scheduled" | "completed";
} {
  if (!a.active) return { label: "Off", tone: "draft" };
  const t = now.getTime();
  if (a.startsAt && new Date(a.startsAt).getTime() > t) {
    return { label: "Scheduled", tone: "scheduled" };
  }
  if (a.endsAt && new Date(a.endsAt).getTime() <= t) {
    return { label: "Ended", tone: "completed" };
  }
  return { label: "Live", tone: "live" };
}
