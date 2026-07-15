"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AccessLevel, SessionStatus } from "@/lib/types";

export interface SessionFormValues {
  title: string;
  description: string;
  category: string;
  startsAt: string; // ISO or ""
  durationMin: number;
  capacity: number | null;
  minAccess: AccessLevel;
  status: SessionStatus;
  /** Speaker record this session links to ("" = none yet). */
  speakerId: string;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  id?: string;
}

function toRow(values: SessionFormValues) {
  return {
    title: values.title,
    description: values.description || null,
    category: values.category || null,
    starts_at: values.startsAt ? new Date(values.startsAt).toISOString() : null,
    duration_min: values.durationMin || null,
    capacity: values.capacity,
    min_access: values.minAccess,
    status: values.status,
    speaker_id: values.speakerId || null,
  };
}

export async function createSession(
  values: SessionFormValues,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      preview: true,
      message: "Session would be created (preview mode — no database).",
    };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("sessions")
    .insert(toRow(values))
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sessions");
  revalidatePath("/sessions");
  return { ok: true, id: data.id, message: "Session created." };
}

export async function updateSession(
  id: string,
  values: SessionFormValues,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.from("sessions").update(toRow(values)).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sessions");
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/sessions");
  return { ok: true, id, message: "Session saved." };
}

export async function deleteSession(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin("sessions");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin.from("sessions").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/sessions");
  revalidatePath("/sessions");
  return { ok: true, message: "Session deleted." };
}
