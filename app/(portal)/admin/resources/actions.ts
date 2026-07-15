"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ResourceInput {
  title: string;
  category: string;
  description: string;
  url: string;
  partnerName: string;
  minAccess: "all_members" | "vip_plus";
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
  const auth = await requireAdmin();
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
  const { error } = await createServiceClient().from("resources").insert(toRow(input));
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Resource added." };
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
