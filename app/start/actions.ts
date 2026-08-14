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
  /*
   * Absolute https only, and checked separately so the message names the
   * right field. A relative value here is the exact bug this setting
   * replaces: "/tickets" resolved against momentumplus.co, where there is
   * no such route, and shipped as a 404 on the buy button.
   */
  const tickets = url(values.ticketsUrl);
  if (tickets === null) {
    return {
      ok: false,
      message:
        "The ticket link must be a full https:// address — a path like /tickets points at this site, which has no ticket page.",
    };
  }
  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: START_HUB_KEY,
      value: {
        tslsOpen: Boolean(values.tslsOpen),
        closedNote: values.closedNote.trim(),
        ...stores,
        ticketsUrl: tickets,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/start");
  return { ok: true, message: "Saved" };
}
