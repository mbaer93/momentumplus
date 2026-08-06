"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { START_HUB_KEY, type StartHubSettings } from "@/lib/start-hub";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface StartHubResult {
  ok: boolean;
  message?: string;
}

/** Save the hub settings: TSLS App open/closed season, the closed-season
    note, and the four store-listing URLs behind the badges. */
export async function saveStartHubSettings(
  values: StartHubSettings,
): Promise<StartHubResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Preview mode — connect Supabase to edit." };
  }
  const url = (s: string) => {
    const t = s.trim();
    if (t && !/^https:\/\//.test(t)) return null;
    return t;
  };
  const stores = {
    momentumAppStoreUrl: url(values.momentumAppStoreUrl),
    momentumPlayUrl: url(values.momentumPlayUrl),
    tslsAppStoreUrl: url(values.tslsAppStoreUrl),
    tslsPlayUrl: url(values.tslsPlayUrl),
  };
  if (Object.values(stores).some((s) => s === null)) {
    return { ok: false, message: "Store links must start with https://" };
  }
  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: START_HUB_KEY,
      value: {
        tslsOpen: Boolean(values.tslsOpen),
        closedNote: values.closedNote.trim(),
        ...stores,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/start");
  return { ok: true, message: "Saved" };
}
