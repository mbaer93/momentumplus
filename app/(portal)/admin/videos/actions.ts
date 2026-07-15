"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
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
  const { error } = await createServiceClient()
    .from("videos")
    .insert({
      ...toRow(input),
      published_at: input.published ? new Date().toISOString() : null,
    });
  if (error) return { ok: false, message: error.message };
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
  refresh();
  return { ok: true, message: "Recording saved." };
}

export async function deleteVideo(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("videos").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Recording deleted." };
}
