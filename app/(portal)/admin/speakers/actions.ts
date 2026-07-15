"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface SpeakerInput {
  name: string;
  title: string;
  bio: string;
  /** Comma-separated in the UI, stored as text[]. */
  industries: string;
  featured: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function toRow(input: SpeakerInput) {
  return {
    name: input.name.trim(),
    title: input.title.trim() || null,
    bio: input.bio.trim() || null,
    industries: input.industries
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    featured: input.featured,
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
  revalidatePath("/admin/speakers");
  revalidatePath("/speakers");
}

export async function createSpeaker(input: SpeakerInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("speakers").insert(toRow(input));
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker added." };
}

export async function updateSpeaker(
  id: string,
  input: SpeakerInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("speakers")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker saved." };
}

export async function deleteSpeaker(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("speakers").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker deleted." };
}
