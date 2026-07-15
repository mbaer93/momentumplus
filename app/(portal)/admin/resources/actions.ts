"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { extractOgImage } from "@/lib/og-image";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const IMAGE_BUCKET = "resource-images";
const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

async function ensureImageBucket(): Promise<void> {
  const admin = createServiceClient();
  // Idempotent: creating an existing bucket errors harmlessly.
  await admin.storage
    .createBucket(IMAGE_BUCKET, { public: true })
    .catch(() => undefined);
}

async function storeResourceImage(
  resourceId: string,
  bytes: Buffer,
  contentType: string,
  suffix: string,
): Promise<string | null> {
  const ext = IMAGE_TYPES[contentType] ?? "img";
  await ensureImageBucket();
  const admin = createServiceClient();
  const path = `${resourceId}${suffix}.${ext}`;
  const { error } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) return null;
  const { data: pub } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  const imageUrl = `${pub.publicUrl}?v=${Date.now()}`;
  await admin.from("resources").update({ image_url: imageUrl }).eq("id", resourceId);
  return imageUrl;
}

/**
 * Fetch the resource link, read its Open Graph preview image (the artwork
 * sites advertise for link shares), and store a copy. Best-effort — many
 * PDFs/drive links have none.
 */
async function tryPullImageFromLink(
  resourceId: string,
  url: string,
): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(url)) return null;
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MomentumPlusBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!pageRes.ok) return null;
    const contentType = pageRes.headers.get("content-type") ?? "";

    let imageUrl: string | null = null;
    if (contentType.includes("text/html")) {
      const html = (await pageRes.text()).slice(0, 500_000);
      imageUrl = extractOgImage(html, pageRes.url ?? url);
    } else if (contentType.startsWith("image/")) {
      imageUrl = url; // the link IS an image
    }
    if (!imageUrl) return null;

    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MomentumPlusBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!imgRes.ok) return null;
    const imgType = (imgRes.headers.get("content-type") ?? "").split(";")[0];
    if (!imgType.startsWith("image/")) return null;
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) return null;

    return await storeResourceImage(resourceId, bytes, imgType, "-og");
  } catch {
    return null;
  }
}

export interface ResourceInput {
  title: string;
  category: string;
  description: string;
  url: string;
  partnerName: string;
  minAccess: "all_members" | "vip_plus" | "pro_only";
  active: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function toRow(input: ResourceInput) {
  return {
    title: input.title.trim(),
    category: input.category.trim() || null,
    description: input.description.trim() || null,
    url: input.url.trim() || null,
    partner_name: input.partnerName.trim() || null,
    min_access: input.minAccess,
    active: input.active,
  };
}

async function guard(): Promise<AdminResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  return null;
}

function refresh() {
  revalidatePath("/admin/resources");
  revalidatePath("/resources");
}

export async function createResource(input: ResourceInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { data: created, error } = await createServiceClient()
    .from("resources")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  // Auto-pull the card image from the link's social preview (best-effort).
  let pulled: string | null = null;
  if (created && input.url.trim()) {
    pulled = await tryPullImageFromLink(created.id, input.url.trim());
  }
  refresh();
  return {
    ok: true,
    message: pulled
      ? "Resource added — card image pulled from the link."
      : "Resource added. (No preview image found at that link — you can upload one from its Edit row.)",
  };
}

/** Re-pull the card image from the resource's link on demand. */
export async function pullResourceImage(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const admin = createServiceClient();
  const { data: row } = await admin
    .from("resources")
    .select("url")
    .eq("id", id)
    .maybeSingle();
  if (!row?.url) {
    return { ok: false, message: "This resource has no link to pull an image from." };
  }
  const pulled = await tryPullImageFromLink(id, row.url);
  refresh();
  return pulled
    ? { ok: true, message: "Image pulled from the link." }
    : {
        ok: false,
        message:
          "That link doesn't advertise a preview image — upload one instead.",
      };
}

/** Upload a card image (PNG/JPG/WebP/GIF/SVG, under 4 MB). */
export async function uploadResourceImage(
  id: string,
  formData: FormData,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file received — choose an image and try again." };
  }
  if (file.size > 4 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `That image is ${mb} MB — the limit is 4 MB. Compress or resize it and try again.`,
    };
  }
  if (!IMAGE_TYPES[file.type]) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — use PNG, JPG, WebP, GIF, or SVG.`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storeResourceImage(id, bytes, file.type, "");
  if (!stored) return { ok: false, message: "Upload failed — try again." };
  refresh();
  return { ok: true, message: "Card image uploaded." };
}

export async function removeResourceImage(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("resources")
    .update({ image_url: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Card image removed." };
}

export async function updateResource(
  id: string,
  input: ResourceInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("resources")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Resource saved." };
}

export async function deleteResource(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("resources").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Resource deleted." };
}
