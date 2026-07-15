import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
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

export async function listSpeakers(): Promise<SpeakerProfile[]> {
  if (!isSupabaseConfigured()) return placeholderSpeakers;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("speakers")
    .select("id, name, title, bio, industries, created_at")
    .order("featured", { ascending: false });
  // Configured mode: empty table = empty directory (demo data is preview-only).
  if (error || !data) return [];

  return data.map((row) => {
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
    } satisfies SpeakerProfile;
  });
}

export async function getSpeaker(id: string): Promise<SpeakerProfile | null> {
  const all = await listSpeakers();
  return all.find((s) => s.id === id) ?? null;
}

export async function listResources(viewerTier: Tier): Promise<ResourceItem[]> {
  if (!isSupabaseConfigured()) {
    // Show all; gated ones render with an Exclusive lock in the UI.
    return placeholderResources;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("resources")
    .select("id, title, category, description, url, partner_name, min_access")
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
    minAccess: row.min_access === "vip_plus" ? "vip_plus" : "all_members",
  }));
}

export function resourceUnlocked(r: ResourceItem, tier: Tier): boolean {
  return canAccess(tier, r.minAccess);
}

export async function listSponsors(): Promise<SponsorItem[]> {
  if (!isSupabaseConfigured()) return placeholderSponsors;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sponsors")
    .select(
      "id, name, tier, tagline, offer, website, logo_url, sidebar_ad_url, rail_active",
    )
    .order("tier");
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier as SponsorItem["tier"],
    tagline: row.tagline ?? "",
    offer: row.offer,
    website: row.website ?? "#",
    // Real sponsors never get mockup wordmark stand-ins; without a logo the
    // mark renders as the sponsor's name.
    wordmark: null,
    logoUrl: row.logo_url ?? null,
    sidebarAdUrl: row.sidebar_ad_url ?? null,
    railActive: Boolean(row.rail_active),
  }));
}

export async function railSponsors(): Promise<SponsorItem[]> {
  const all = await listSponsors();
  return all.filter((s) => s.railActive).slice(0, 3);
}
