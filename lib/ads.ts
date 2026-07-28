/*
 * Ad and notice placements (migration 0056).
 *
 * Slots used to be implicit: the rail was "the top three sponsor tiers", the
 * in-body banner was "Momentum+ Sponsor and Title", and both were decided in
 * code. Now a slot is a row, a creative is a row, and which creative sits
 * where — and in what order — is edited in Admin → Ad Manager.
 *
 * Sponsor-linked creatives keep flowing through the existing sponsor_events
 * pipeline, so their views and clicks still land in Admin → Analytics.
 */

import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { requestCache } from "./request-cache";

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

function mapAd(r: Record<string, unknown>): AdCreative {
  return {
    id: String(r.id),
    placementKey: String(r.placement_key),
    kind: r.kind === "notice" ? "notice" : "ad",
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    ctaLabel: String(r.cta_label ?? ""),
    url: String(r.url ?? ""),
    imageUrl: (r.image_url as string | null) ?? null,
    sponsorId: (r.sponsor_id as string | null) ?? null,
    sort: Number(r.sort ?? 100),
    active: r.active !== false,
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
  };
}

export const listPlacements = requestCache(
  async (): Promise<AdPlacement[]> => {
    if (!isSupabaseConfigured()) return FALLBACK_PLACEMENTS;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ad_placements")
      .select("key, label, description, sort")
      .order("sort");
    if (error || !data?.length) return FALLBACK_PLACEMENTS;
    return data.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      description: String(r.description ?? ""),
      sort: Number(r.sort ?? 100),
    }));
  },
);

/**
 * Everything currently live, in display order.
 *
 * RLS does the flight-date and active filtering, so a scheduled creative can
 * be written well in advance without a member ever seeing it. Admins get the
 * unfiltered list, which is what the manager wants — so the manager asks for
 * `includeInactive` and everyone else takes the default.
 */
export const listAds = requestCache(async (): Promise<AdCreative[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ads")
    .select(
      "id, placement_key, kind, title, body, cta_label, url, image_url, sponsor_id, sort, active, starts_at, ends_at",
    )
    .order("sort");
  // Pre-migration: no ad manager yet, and the sponsor rail carries on as it
  // did before. An empty list is the right answer, not an error page.
  if (error) return [];
  return (data ?? []).map(mapAd);
});

/** Live creatives for one slot, ready to render. */
export async function adsFor(placementKey: string): Promise<AdCreative[]> {
  const now = Date.now();
  return (await listAds()).filter(
    (a) =>
      a.placementKey === placementKey &&
      a.active &&
      (!a.startsAt || new Date(a.startsAt).getTime() <= now) &&
      (!a.endsAt || new Date(a.endsAt).getTime() > now),
  );
}

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
