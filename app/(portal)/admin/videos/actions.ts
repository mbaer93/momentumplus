"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  createMuxDirectUpload,
  getMuxAsset,
  getMuxUpload,
  isMuxConfigured,
  requestMuxAutoCaptions,
} from "@/lib/mux";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface VideoInput {
  title: string;
  category: string;
  muxPlaybackId: string;
  durationMin: number;
  minAccess: "all_members" | "vip_plus" | "pro_only";
  published: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function toRow(input: VideoInput) {
  return {
    title: input.title.trim(),
    category: input.category.trim() || null,
    mux_playback_id: input.muxPlaybackId.trim() || null,
    duration_sec: input.durationMin > 0 ? Math.round(input.durationMin * 60) : null,
    min_access: input.minAccess,
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
  revalidatePath("/admin/videos");
  revalidatePath("/library");
}

export async function createVideo(input: VideoInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { data: created, error } = await createServiceClient()
    .from("videos")
    .insert({
      ...toRow(input),
      published_at: input.published ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  if (input.published && created) {
    const { notifyMembersInApp } = await import("@/lib/engagement-notify");
    await notifyMembersInApp({
      minAccess: input.minAccess,
      key: "recording_ready",
      title: "New recording in the Library",
      body: input.title,
      link: `/library/${created.id}`,
    });
  }
  refresh();
  return { ok: true, message: "Recording added." };
}

export async function updateVideo(
  id: string,
  input: VideoInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const admin = createServiceClient();
  // Preserve the original publish date when it stays published.
  const { data: existing } = await admin
    .from("videos")
    .select("published_at")
    .eq("id", id)
    .maybeSingle();
  const published_at = input.published
    ? existing?.published_at ?? new Date().toISOString()
    : null;

  const { error } = await admin
    .from("videos")
    .update({ ...toRow(input), published_at })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  if (input.published && !existing?.published_at) {
    const { notifyMembersInApp } = await import("@/lib/engagement-notify");
    await notifyMembersInApp({
      minAccess: input.minAccess,
      key: "recording_ready",
      title: "New recording in the Library",
      body: input.title,
      link: `/library/${id}`,
    });
  }
  refresh();
  return { ok: true, message: "Recording saved." };
}

export interface UploadSlotResult extends AdminResult {
  uploadId?: string;
  uploadUrl?: string;
}

/**
 * Step 1 of an in-app upload: create a Mux direct-upload slot. The browser
 * PUTs the video file straight to Mux — it never passes through our server.
 */
export async function createVideoUpload(): Promise<UploadSlotResult> {
  const early = await guard();
  if (early) return early;
  if (!isMuxConfigured()) {
    return {
      ok: false,
      message:
        "Mux isn't connected yet — add MUX_TOKEN_ID and MUX_TOKEN_SECRET in Vercel (see Admin → Connections).",
    };
  }
  try {
    const upload = await createMuxDirectUpload(
      process.env.NEXT_PUBLIC_SITE_URL ?? "*",
    );
    return { ok: true, uploadId: upload.id, uploadUrl: upload.url };
  } catch (e) {
    return { ok: false, message: `Mux error: ${(e as Error).message}` };
  }
}

/**
 * Step 2, after the browser finishes uploading: resolve the Mux asset and
 * create the Library recording with its playback ID (and duration once Mux
 * reports it).
 */
export async function finalizeVideoUpload(
  uploadId: string,
  input: VideoInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  try {
    // The asset is usually created within a few seconds of upload completion.
    let assetId: string | undefined;
    for (let attempt = 0; attempt < 10 && !assetId; attempt++) {
      const upload = await getMuxUpload(uploadId);
      if (upload.status === "errored" || upload.status === "timed_out") {
        return { ok: false, message: "Mux couldn't process that upload — try again." };
      }
      assetId = upload.asset_id;
      if (!assetId) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!assetId) {
      return {
        ok: false,
        message:
          "Mux is still receiving the file — wait a moment and click Finish again.",
      };
    }

    const asset = await getMuxAsset(assetId);
    if (asset.status === "errored") {
      return { ok: false, message: "Mux couldn't process that video file." };
    }
    const playbackId = asset.playback_ids?.[0]?.id ?? null;
    const durationSec = asset.duration
      ? Math.round(asset.duration)
      : input.durationMin > 0
        ? Math.round(input.durationMin * 60)
        : null;

    // Kick off auto-captions now when the audio track is already visible;
    // otherwise the summaries cron requests them once the asset is ready.
    const audioTrack = asset.tracks?.find((t) => t.type === "audio");
    const hasText = asset.tracks?.some((t) => t.type === "text");
    if (audioTrack && !hasText) {
      try {
        await requestMuxAutoCaptions(assetId, audioTrack.id);
      } catch {
        // non-fatal — cron retries
      }
    }

    // Idempotent on the Mux asset: double-clicking Finish (or a retry after
    // a slow response) must not create duplicate library rows.
    const service = createServiceClient();
    const { data: existing } = await service
      .from("videos")
      .select("id")
      .eq("mux_asset_id", assetId)
      .maybeSingle();
    if (existing) {
      refresh();
      return { ok: true, message: "That upload is already in the Library." };
    }

    const { data: created, error } = await service
      .from("videos")
      .insert({
        title: input.title.trim(),
        category: input.category.trim() || null,
        mux_playback_id: playbackId,
        mux_asset_id: assetId,
        duration_sec: durationSec,
        min_access: input.minAccess,
        published_at: input.published ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    if (input.published && created) {
      const { notifyMembersInApp } = await import("@/lib/engagement-notify");
      await notifyMembersInApp({
        minAccess: input.minAccess,
        key: "recording_ready",
        title: "New recording in the Library",
        body: input.title.trim(),
        link: `/library/${created.id}`,
      });
    }
    refresh();
    return {
      ok: true,
      message:
        asset.status === "ready"
          ? "Recording uploaded and live."
          : "Recording uploaded — Mux is finishing processing; playback starts automatically in a minute or two.",
    };
  } catch (e) {
    return { ok: false, message: `Mux error: ${(e as Error).message}` };
  }
}

const THUMB_BUCKET = "video-thumbnails";
const THUMB_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Upload a custom card thumbnail (PNG/JPG/WebP, under 4 MB). It overrides
 * the default screen grab Mux pulls from the video.
 */
export async function uploadVideoThumbnail(
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
  const ext = THUMB_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — use PNG, JPG, or WebP.`,
    };
  }

  const admin = createServiceClient();
  await admin.storage
    .createBucket(THUMB_BUCKET, { public: true })
    .catch(() => undefined);
  const path = `${id}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(THUMB_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
    });
  if (upErr) return { ok: false, message: `Upload failed: ${upErr.message}` };
  const { data: pub } = admin.storage.from(THUMB_BUCKET).getPublicUrl(path);
  const thumbnailUrl = `${pub.publicUrl}?v=${Date.now()}`;
  const { error } = await admin
    .from("videos")
    .update({ thumbnail_url: thumbnailUrl })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Thumbnail uploaded — it now replaces the screen grab." };
}

/** Back to the default: the screen grab Mux pulls from the video itself. */
export async function removeVideoThumbnail(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("videos")
    .update({ thumbnail_url: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Custom thumbnail removed — the card uses the video screen grab again." };
}

export async function deleteVideo(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("videos").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Recording deleted." };
}
