"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ServiceInput {
  name: string;
  tagline: string;
  description: string;
  url: string;
  priceLabel: string;
  sortOrder: string;
  active: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function toRow(input: ServiceInput) {
  const sort = Number.parseInt(input.sortOrder, 10);
  return {
    name: input.name.trim(),
    tagline: input.tagline.trim() || null,
    description: input.description.trim() || null,
    url: input.url.trim() || null,
    price_label: input.priceLabel.trim() || null,
    sort_order: Number.isFinite(sort) ? sort : 0,
    active: input.active,
  };
}

function bust() {
  revalidatePath("/services");
  revalidatePath("/admin/services");
}

export async function createService(input: ServiceInput): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.name.trim()) return { ok: false, message: "The service needs a name." };

  const { error } = await createServiceClient().from("services").insert(toRow(input));
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Service added." };
}

export async function updateService(
  id: string,
  input: ServiceInput,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.name.trim()) return { ok: false, message: "The service needs a name." };

  const { error } = await createServiceClient()
    .from("services")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Service saved." };
}

export async function deleteService(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { error } = await createServiceClient().from("services").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Service deleted." };
}
