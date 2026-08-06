"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { START_HUB_KEY } from "@/lib/start-hub";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface StartHubResult {
  ok: boolean;
  message?: string;
}

/** Flip the TSLS App between open season and closed, and set the note
    members see while it's closed. */
export async function saveStartHubSettings(values: {
  tslsOpen: boolean;
  closedNote: string;
}): Promise<StartHubResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode — connect Supabase to edit." };
  }
  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: START_HUB_KEY,
      value: {
        tslsOpen: Boolean(values.tslsOpen),
        closedNote: values.closedNote.trim(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/start");
  return { ok: true, message: "Saved" };
}
