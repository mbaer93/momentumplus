"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { ASPIRE_COPY_KEY } from "@/lib/aspire-copy";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface AspireCopyResult {
  ok: boolean;
  message?: string;
}

/** Save the A2A page description (admins with content access). */
export async function saveAspireCopy(text: string): Promise<AspireCopyResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode — connect Supabase to edit." };
  }
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: "The description can't be empty." };
  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: ASPIRE_COPY_KEY,
      value: { text: trimmed },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/aspire2achieve");
  return { ok: true, message: "Description saved" };
}
