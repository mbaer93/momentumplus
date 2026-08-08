"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { imageSrcOk } from "@/lib/image-src";

export interface AdResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

const PREVIEW: AdResult = {
  ok: true,
  preview: true,
  message: "Saved (preview mode — no database configured).",
};

export interface AdInput {
  placementKey: string;
  kind: "ad" | "notice";
  title: string;
  body: string;
  ctaLabel: string;
  url: string;
  imageUrl: string;
  sponsorId: string;
  active: boolean;
  /** Datetime-local strings from the form, or "" for no bound. */
  startsAt: string;
  endsAt: string;
  /** Member-type slugs that see this creative. Empty = every member. */
  tiers: string[];
}

function bust() {
  // Placements render inside the portal shell and on most member pages.
  revalidatePath("/", "layout");
}

async function guard() {
  const auth = await requireAdmin("sponsors");
  return auth.ok ? null : auth.message;
}

function toRow(input: AdInput) {
  const iso = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return {
    placement_key: input.placementKey,
    kind: input.kind === "notice" ? "notice" : "ad",
    title: input.title.trim(),
    body: input.body.trim(),
    cta_label: input.ctaLabel.trim() || null,
    url: input.url.trim() || null,
    // A pasted URL on a host next/image can't load throws at render and
    // 500s every page carrying the ad, so it's rejected rather than stored.
    image_url: imageSrcOk(input.imageUrl) ? input.imageUrl.trim() : null,
    // A house notice has no advertiser; only a real uuid is stored.
    sponsor_id: input.sponsorId.trim() || null,
    active: input.active,
    starts_at: iso(input.startsAt),
    ends_at: iso(input.endsAt),
    // Null (not []) when untargeted, so "every member" reads the same in
    // the database whether the row predates 0058 or was saved after it.
    tiers: input.tiers.length > 0 ? input.tiers : null,
  };
}

function validate(input: AdInput): string | null {
  if (!input.title.trim()) return "The ad needs a title.";
  if (!input.placementKey.trim()) return "Pick where it should appear.";
  const start = input.startsAt.trim() ? new Date(input.startsAt) : null;
  const end = input.endsAt.trim() ? new Date(input.endsAt) : null;
  if (start && end && end <= start) {
    return "The end date has to be after the start date.";
  }
  // Site paths ("/upgrade") are first-class: the renderers use client-side
  // navigation for them, and upgrade/renewal pages are exactly what house
  // notices want to point at.
  if (input.url.trim() && !/^(https?:\/\/|\/)/i.test(input.url.trim())) {
    return "The link needs a full https:// address, or a site page like /upgrade.";
  }
  return null;
}

export async function createAd(input: AdInput): Promise<AdResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  const invalid = validate(input);
  if (invalid) return { ok: false, message: invalid };

  const db = createServiceClient();
  // New creatives go to the end of their placement rather than the top —
  // a new ad shouldn't silently outrank one that's already been sold.
  const { data: last } = await db
    .from("ads")
    .select("sort")
    .eq("placement_key", input.placementKey)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = Number(last?.sort ?? 0) + 10;

  const { error } = await db.from("ads").insert({ ...toRow(input), sort });
  if (error) {
    return {
      ok: false,
      message: /relation "ads"|ad_placements/.test(error.message)
        ? "Run 0056_ad_manager.sql in Supabase to turn on the ad manager."
        : /tiers/.test(error.message)
          ? "Run 0058_ad_tier_targeting.sql in Supabase to turn on tier targeting."
          : error.message,
    };
  }
  bust();
  return { ok: true, message: "Added." };
}

export async function updateAd(id: string, input: AdInput): Promise<AdResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  const invalid = validate(input);
  if (invalid) return { ok: false, message: invalid };

  const { error } = await createServiceClient()
    .from("ads")
    .update(toRow(input))
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      message: /tiers/.test(error.message)
        ? "Run 0058_ad_tier_targeting.sql in Supabase to turn on tier targeting."
        : error.message,
    };
  }
  bust();
  return { ok: true, message: "Saved." };
}

export async function deleteAd(id: string): Promise<AdResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const { error } = await createServiceClient().from("ads").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Deleted." };
}

/**
 * Move a creative up or down within its placement.
 *
 * Swaps sort values with its neighbour rather than renumbering the list:
 * two writes instead of N, and any row not involved keeps the position an
 * advertiser was sold.
 */
export async function moveAd(
  id: string,
  direction: "up" | "down",
): Promise<AdResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const db = createServiceClient();
  const { data: me } = await db
    .from("ads")
    .select("id, placement_key, sort")
    .eq("id", id)
    .maybeSingle();
  if (!me) return { ok: false, message: "That ad no longer exists." };

  // "up" wants the largest sort below this one; "down" the smallest above.
  const base = db
    .from("ads")
    .select("id, sort")
    .eq("placement_key", me.placement_key)
    .order("sort", { ascending: direction === "down" })
    .limit(1);
  const { data: neighbour } =
    direction === "up"
      ? await base.lt("sort", me.sort).maybeSingle()
      : await base.gt("sort", me.sort).maybeSingle();
  // Already at the end of its placement — a no-op, not an error.
  if (!neighbour) return { ok: true };

  await db.from("ads").update({ sort: neighbour.sort }).eq("id", me.id);
  await db.from("ads").update({ sort: me.sort }).eq("id", neighbour.id);
  bust();
  return { ok: true };
}
