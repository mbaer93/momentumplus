import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import { RAIL_TIERS, normalizeSponsorTier } from "@/lib/sponsor-tiers";
import {
  inNextSeason,
  sponsorActive,
  sponsorLive,
  speakerLive,
} from "@/lib/sponsor-lifecycle";
import type { Tier } from "@/lib/types";
import {
  resources as placeholderResources,
  speakers as placeholderSpeakers,
  sponsors as placeholderSponsors,
  type ResourceItem,
  type SpeakerProfile,
  type SponsorItem,
} from "./directory-data";

/*
 * Directory data access (speakers / resources / sponsors). Supabase when
 * configured (RLS enforces visibility); placeholder set in preview mode.
 * DB rows without display art fall back to deterministic styling.
 */

const BANNERS = [
  "linear-gradient(135deg,#0B1622,#1C3050)",
  "linear-gradient(135deg,#0B1622,#3A6B96)",
  "linear-gradient(135deg,#0B1622,#3A7055)",
  "linear-gradient(135deg,#0B1622,#5C3D7A)",
  "linear-gradient(135deg,#0B1622,#A04040)",
];
const AV_BGS = ["#1C3050", "#3A6B96", "#3A7055", "#5C3D7A", "#A04040"];

function hashIndex(id: string, mod: number): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % mod;
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/*
 * The speaker/sponsor directories are identical for every member, so the
 * rows are fetched through the service role inside a 5-minute
 * unstable_cache instead of once per request per user. Admin mutations
 * bust the tags (revalidateTag in the admin actions).
 */
interface SpeakerRow {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  industries: string[] | null;
  headshot_url: string | null;
  website: string | null;
  created_at: string;
  expires_at?: string | null;
  archived_at?: string | null;
}

const SPEAKER_COLUMNS =
  "id, name, title, bio, industries, headshot_url, website, created_at, expires_at, archived_at";
// Pre-migration fallback (before 0028 adds the lifecycle columns).
const SPEAKER_COLUMNS_LEGACY =
  "id, name, title, bio, industries, headshot_url, website, created_at";

const cachedSpeakerRows = unstable_cache(
  async (): Promise<SpeakerRow[]> => {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const admin = createServiceClient();
    let data = (
      await admin
        .from("speakers")
        .select(SPEAKER_COLUMNS)
        .order("featured", { ascending: false })
    ).data as SpeakerRow[] | null;
    if (!data) {
      data = (
        await admin
          .from("speakers")
          .select(SPEAKER_COLUMNS_LEGACY)
          .order("featured", { ascending: false })
      ).data as SpeakerRow[] | null;
    }
    return data ?? [];
  },
  ["speakers-directory"],
  { revalidate: 300, tags: ["speakers"] },
);

export async function listSpeakers(): Promise<SpeakerProfile[]> {
  if (!isSupabaseConfigured()) return placeholderSpeakers;

  let data: SpeakerRow[];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    data = await cachedSpeakerRows();
  } else {
    const supabase = createClient();
    let rows = (
      await supabase
        .from("speakers")
        .select(SPEAKER_COLUMNS)
        .order("featured", { ascending: false })
    ).data as SpeakerRow[] | null;
    if (!rows) {
      rows = (
        await supabase
          .from("speakers")
          .select(SPEAKER_COLUMNS_LEGACY)
          .order("featured", { ascending: false })
      ).data as SpeakerRow[] | null;
    }
    // Configured mode: empty table = empty directory (demo is preview-only).
    if (!rows) return [];
    data = rows;
  }

  // Members only see LIVE speakers: not archived, not season-expired, and
  // not pre-season (new speakers stay hidden until October 1 of the year
  // they join). Filtered per-request, not in the cached query, so the
  // cache can't serve a stale list across a season boundary.
  return data
    .filter((row) =>
      speakerLive({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSpeakerRow);
}

function mapSpeakerRow(row: SpeakerRow): SpeakerProfile {
  const i = hashIndex(row.id, BANNERS.length);
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    initials: initialsOf(row.name),
    avatarBg: AV_BGS[i],
    avatarColor: i === 0 ? "#D4AE75" : "#fff",
    bannerGradient: BANNERS[i],
    industries: row.industries ?? [],
    bio: row.bio ?? "",
    memberSince: new Date(row.created_at).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    }),
    sessionCount: 0,
    sessionSlugs: [],
    headshotUrl: row.headshot_url ?? null,
    website: row.website ?? null,
  } satisfies SpeakerProfile;
}

export async function getSpeaker(id: string): Promise<SpeakerProfile | null> {
  const all = await listSpeakers();
  return all.find((s) => s.id === id) ?? null;
}

/**
 * Admin variant: includes PRE-SEASON speakers (hidden from members until
 * October 1) so sessions for the upcoming season can be assigned to them.
 * Archived/expired speakers stay out, same as the member list.
 */
export async function listSpeakersForAdmin(): Promise<SpeakerProfile[]> {
  if (!isSupabaseConfigured()) return placeholderSpeakers;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return listSpeakers();
  const data = await cachedSpeakerRows();
  return data
    .filter((row) =>
      sponsorActive({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSpeakerRow);
}

/**
 * Names of active admins, for the drop-in host picker (Rooted Focus /
 * Aspire2Achieve are led by the SLC team, never a speaker). The picked name
 * lands in sessions.host_name — no FK, so this is display data only.
 */
export async function listAdminHostNames(): Promise<string[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { createServiceClient } = await import("@/lib/supabase/admin");
  const admin = createServiceClient();
  const { data } = await admin
    .from("memberships")
    .select("profiles ( full_name )")
    .eq("tier", "admin")
    .eq("status", "active");
  const names = (data ?? [])
    .map((row) => {
      const p = row.profiles as { full_name: string | null } | { full_name: string | null }[] | null;
      return Array.isArray(p) ? p[0]?.full_name : p?.full_name;
    })
    .filter((n): n is string => Boolean(n && n.trim()));
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export async function listResources(viewerTier: Tier): Promise<ResourceItem[]> {
  if (!isSupabaseConfigured()) {
    // Show all; gated ones render with an Exclusive lock in the UI.
    return placeholderResources;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("resources")
    .select("id, title, category, description, url, partner_name, min_access, image_url")
    .eq("active", true);
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    type: row.category ?? "Resource",
    typeColor: "var(--gold)",
    iconBg: "var(--gold-pale)",
    title: row.title,
    description: row.description ?? "",
    tags: [row.category, row.partner_name].filter(Boolean) as string[],
    actionLabel: "Open",
    url: row.url ?? "#",
    imageUrl: row.image_url ?? null,
    minAccess:
      row.min_access === "vip_plus" || row.min_access === "pro_only"
        ? row.min_access
        : "all_members",
  }));
}

export function resourceUnlocked(r: ResourceItem, tier: Tier): boolean {
  return canAccess(tier, r.minAccess);
}

interface SponsorRow {
  id: string;
  name: string;
  tier: string;
  tagline: string | null;
  offer: string | null;
  website: string | null;
  logo_url: string | null;
  sidebar_ad_url: string | null;
  rail_active: boolean | null;
  expires_at: string | null;
  archived_at: string | null;
  description?: string | null;
}

const SPONSOR_COLUMNS =
  "id, name, tier, tagline, description, offer, website, logo_url, sidebar_ad_url, rail_active, expires_at, archived_at";
// Pre-migration fallback (before 0033 adds description).
const SPONSOR_COLUMNS_LEGACY =
  "id, name, tier, tagline, offer, website, logo_url, sidebar_ad_url, rail_active, expires_at, archived_at";

const cachedSponsorRows = unstable_cache(
  async (): Promise<SponsorRow[]> => {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const admin = createServiceClient();
    let data = (
      await admin.from("sponsors").select(SPONSOR_COLUMNS).order("tier")
    ).data as SponsorRow[] | null;
    if (!data) {
      data = (
        await admin.from("sponsors").select(SPONSOR_COLUMNS_LEGACY).order("tier")
      ).data as SponsorRow[] | null;
    }
    return data ?? [];
  },
  ["sponsors-directory"],
  { revalidate: 300, tags: ["sponsors"] },
);

export async function listSponsors(): Promise<SponsorItem[]> {
  if (!isSupabaseConfigured()) return placeholderSponsors;

  let data: SponsorRow[];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    data = await cachedSponsorRows();
  } else {
    const supabase = createClient();
    let rows = (
      await supabase.from("sponsors").select(SPONSOR_COLUMNS).order("tier")
    ).data as SponsorRow[] | null;
    if (!rows) {
      rows = (
        await supabase
          .from("sponsors")
          .select(SPONSOR_COLUMNS_LEGACY)
          .order("tier")
      ).data as SponsorRow[] | null;
    }
    if (!rows) return [];
    data = rows;
  }

  // Members only see LIVE sponsors: not archived, not term-expired, and —
  // same as speakers — not pre-season (a sponsor onboarding mid-year stays
  // hidden until October 1). Filtered per-request, not in the cached query,
  // so the cache can't serve a stale list across a season boundary.
  return data
    .filter((row) =>
      sponsorLive({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSponsorRow);
}

/**
 * Admin/preview variant: includes PRE-SEASON sponsors (hidden from members
 * until October 1) so their profile pages can be previewed while they prep.
 * Archived/expired sponsors stay out, same as the member list.
 */
export async function listSponsorsForAdmin(): Promise<SponsorItem[]> {
  if (!isSupabaseConfigured()) return placeholderSponsors;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return listSponsors();
  const data = await cachedSponsorRows();
  return data
    .filter((row) =>
      sponsorActive({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSponsorRow);
}

function mapSponsorRow(row: SponsorRow): SponsorItem {
  return {
    id: row.id,
    name: row.name,
    tier: normalizeSponsorTier(row.tier),
    tagline: row.tagline ?? "",
    description: row.description ?? "",
    offer: row.offer,
    website: row.website ?? "#",
    // Real sponsors never get mockup wordmark stand-ins; without a logo the
    // mark renders as the sponsor's name.
    wordmark: null,
    logoUrl: row.logo_url ?? null,
    sidebarAdUrl: row.sidebar_ad_url ?? null,
    railActive: Boolean(row.rail_active),
  };
}

/**
 * NEXT-SEASON previews (admins, speakers, sponsor managers): everyone whose
 * term runs past the upcoming October 1 — i.e., the roster the portal will
 * show once the season flips. Terms all end on an October 1, so this is
 * exactly the pre-season cohort plus nobody from the current season.
 */
export async function listSpeakersNextSeason(): Promise<SpeakerProfile[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const data = await cachedSpeakerRows();
  return data
    .filter((row) =>
      inNextSeason({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSpeakerRow);
}

export async function listSponsorsNextSeason(): Promise<SponsorItem[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const data = await cachedSponsorRows();
  return data
    .filter((row) =>
      inNextSeason({
        archivedAt: row.archived_at ?? null,
        expiresAt: row.expires_at ?? null,
      }),
    )
    .map(mapSponsorRow);
}

export async function getSponsor(id: string): Promise<SponsorItem | null> {
  const all = await listSponsors();
  return all.find((s) => s.id === id) ?? null;
}

export async function railSponsors(): Promise<SponsorItem[]> {
  const all = await listSponsors();
  // Rail ads are reserved for the top tiers (Momentum+ Sponsor, Title,
  // Platinum) — lower tiers appear on the Sponsors tab only.
  return all
    .filter((s) => s.railActive && RAIL_TIERS.has(s.tier))
    .slice(0, 3);
}
