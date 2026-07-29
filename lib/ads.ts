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
import { getCurrentMember } from "./current-member";
import { listSponsors } from "./directory-queries";
import type { SponsorItem } from "./directory-data";
import { requestCache } from "./request-cache";
import {
  FALLBACK_PLACEMENTS,
  type AdCreative,
  type AdPlacement,
} from "./ads-shared";

export {
  FALLBACK_PLACEMENTS,
  adStatus,
  type AdCreative,
  type AdPlacement,
} from "./ads-shared";

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
    tiers: Array.isArray(r.tiers) ? (r.tiers as unknown[]).map(String) : [],
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
      "id, placement_key, kind, title, body, cta_label, url, image_url, sponsor_id, sort, active, starts_at, ends_at, tiers",
    )
    .order("sort");
  if (error) {
    // 0056 ran but 0058 hasn't: the tiers column doesn't exist yet. Retry
    // without it so every existing ad keeps rendering untargeted, instead
    // of the whole slot system going dark until the migration runs.
    if (/tiers/.test(error.message)) {
      const retry = await supabase
        .from("ads")
        .select(
          "id, placement_key, kind, title, body, cta_label, url, image_url, sponsor_id, sort, active, starts_at, ends_at",
        )
        .order("sort");
      if (!retry.error) return (retry.data ?? []).map(mapAd);
    }
    // Pre-migration: no ad manager yet, and the sponsor rail carries on as
    // it did before. An empty list is the right answer, not an error page.
    return [];
  }
  return (data ?? []).map(mapAd);
});

/** Live creatives for one slot, ready to render. */
export async function adsFor(placementKey: string): Promise<AdCreative[]> {
  const now = Date.now();
  // RLS already keeps tier-targeted rows away from members outside the
  // target list; this re-check is what makes view-as honest (the request
  // still runs as the admin, so Postgres answers with everything) and what
  // narrows the admin's own portal browsing when they preview a tier.
  const member = await getCurrentMember();
  const seesAllTiers = Boolean(member?.isAdmin && !member.viewingAs);
  return (await listAds()).filter(
    (a) =>
      a.placementKey === placementKey &&
      a.active &&
      (!a.startsAt || new Date(a.startsAt).getTime() <= now) &&
      (!a.endsAt || new Date(a.endsAt).getTime() > now) &&
      (a.tiers.length === 0 ||
        seesAllTiers ||
        (member !== null && a.tiers.includes(member.tier))),
  );
}

/** What a sponsor-card renderer needs beyond the ad row itself. */
export interface AdSponsorVisual {
  id: string;
  name: string;
  tagline: string;
  offer: string | null;
  logoUrl: string | null;
  sidebarAdUrl: string | null;
  wordmark: SponsorItem["wordmark"];
}

export type HydratedAd = AdCreative & { sponsor: AdSponsorVisual | null };

/**
 * Live creatives for one slot with sponsor-linked rows filled in.
 *
 * A sponsor-linked row seeded (or saved) with blank fields inherits the
 * sponsor's profile — name, tagline, uploaded ad creative, and a link to
 * their profile page — so the creative keeps being managed in
 * Admin → Sponsors while the Ad Manager decides placement and order.
 * Anything the row does set overrides the inherited value.
 */
export async function hydratedAdsFor(
  placementKey: string,
): Promise<HydratedAd[]> {
  const ads = await adsFor(placementKey);
  if (ads.length === 0) return [];
  const sponsors = ads.some((a) => a.sponsorId)
    ? await listSponsors()
    : [];
  return ads.map((a) => {
    const s = a.sponsorId
      ? (sponsors.find((x) => x.id === a.sponsorId) ?? null)
      : null;
    if (!s) return { ...a, sponsor: null };
    return {
      ...a,
      title: a.title || s.name,
      body: a.body || s.tagline,
      imageUrl: a.imageUrl || s.sidebarAdUrl,
      url: a.url || `/sponsors/${s.id}`,
      ctaLabel: a.ctaLabel || "Learn more",
      sponsor: {
        id: s.id,
        name: s.name,
        tagline: s.tagline,
        offer: s.offer,
        logoUrl: s.logoUrl,
        sidebarAdUrl: s.sidebarAdUrl,
        wordmark: s.wordmark,
      },
    };
  });
}

