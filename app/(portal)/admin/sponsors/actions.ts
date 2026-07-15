"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { PRESENTED_BY_PATH } from "@/lib/presented-by";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface SponsorInput {
  name: string;
  tier: "title" | "partner" | "community";
  tagline: string;
  offer: string;
  website: string;
  railActive: boolean;
}

export interface SponsorResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

export async function createSponsor(input: SponsorInput): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Created (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.from("sponsors").insert({
    name: input.name.trim(),
    tier: input.tier,
    tagline: input.tagline.trim() || null,
    offer: input.offer.trim() || null,
    website: input.website.trim() || null,
    rail_active: input.railActive,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  return { ok: true, message: "Sponsor created." };
}

export async function toggleRail(
  sponsorId: string,
  railActive: boolean,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Toggled (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({ rail_active: railActive })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  return { ok: true };
}

export async function deleteSponsor(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.from("sponsors").delete().eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  return { ok: true, message: "Sponsor deleted." };
}

export async function updateSponsor(
  sponsorId: string,
  input: SponsorInput,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({
      name: input.name.trim(),
      tier: input.tier,
      tagline: input.tagline.trim() || null,
      offer: input.offer.trim() || null,
      website: input.website.trim() || null,
      rail_active: input.railActive,
    })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  return { ok: true, message: "Sponsor saved." };
}

/**
 * Upload a sponsor graphic to the public sponsor-logos bucket and store its
 * URL on the sponsor row. Two kinds: the logo (profile/cards) and the sidebar
 * ad creative (left-panel slot). FormData: { file: File }. PNG/JPG/SVG/WebP
 * up to 2 MB.
 */
async function uploadSponsorImage(
  sponsorId: string,
  formData: FormData,
  kind: "logo" | "sidebar_ad",
): Promise<SponsorResult> {
  const label = kind === "logo" ? "Logo" : "Ad graphic";
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Uploaded (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "No file received — choose an image and try the upload again.",
    };
  }
  if (file.size > 2 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `${label} is ${mb} MB — the limit is 2 MB. Compress or resize the image and try again.`,
    };
  }
  const allowed: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const ext = allowed[file.type];
  if (!ext) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — upload a PNG, JPG, SVG, or WebP instead.`,
    };
  }

  const admin = createServiceClient();
  const path =
    kind === "logo" ? `${sponsorId}.${ext}` : `${sponsorId}-ad.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("sponsor-logos")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { data: pub } = admin.storage.from("sponsor-logos").getPublicUrl(path);
  // Cache-bust so a replaced graphic shows immediately.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error } = await admin
    .from("sponsors")
    .update(kind === "logo" ? { logo_url: url } : { sidebar_ad_url: url })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidatePath("/sponsors");
  revalidatePath("/", "layout");
  return { ok: true, message: `${label} uploaded.` };
}

export async function uploadSponsorLogo(
  sponsorId: string,
  formData: FormData,
): Promise<SponsorResult> {
  return uploadSponsorImage(sponsorId, formData, "logo");
}

export async function uploadSponsorAd(
  sponsorId: string,
  formData: FormData,
): Promise<SponsorResult> {
  return uploadSponsorImage(sponsorId, formData, "sidebar_ad");
}

/**
 * Upload the site-wide "Presented by" logo (left panel). One slot — it
 * belongs to the current Momentum+ Sponsor and is replaced when a new
 * sponsor takes over. Stored at a fixed bucket path, no sponsor row needed.
 */
export async function uploadPresentedByLogo(
  formData: FormData,
): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Uploaded (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "No file received — choose an image and try the upload again.",
    };
  }
  if (file.size > 2 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `Presented-by logo is ${mb} MB — the limit is 2 MB. Compress or resize the image and try again.`,
    };
  }
  const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — upload a PNG, JPG, SVG, or WebP instead.`,
    };
  }

  const admin = createServiceClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from("sponsor-logos")
    .upload(PRESENTED_BY_PATH, bytes, { contentType: file.type, upsert: true });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/sponsors");
  revalidatePath("/", "layout");
  return { ok: true, message: "Presented-by logo uploaded." };
}

/** Remove the presented-by logo (the slot falls back to the sponsor's regular logo/name). */
export async function removePresentedByLogo(): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Removed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.storage
    .from("sponsor-logos")
    .remove([PRESENTED_BY_PATH]);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/", "layout");
  return { ok: true, message: "Presented-by logo removed." };
}

/** Remove the ad creative (the rail card falls back to the logo layout). */
export async function removeSponsorAd(sponsorId: string): Promise<SponsorResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Removed (preview mode)." };
  }
  const auth = await requireAdmin("sponsors");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("sponsors")
    .update({ sidebar_ad_url: null })
    .eq("id", sponsorId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sponsors");
  revalidatePath("/", "layout");
  return { ok: true, message: "Ad graphic removed." };
}
