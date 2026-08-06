import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/* The /start hub (Matt, 2026-08-06): one link that offers both systems —
   Momentum+ and the TSLS event app. Whether the TSLS App is open is an
   admin toggle here (its season opens ~2 months around the summit); when
   closed the hub swaps the app button for next year's ticket purchase.
   Store URLs render App Store / Google Play badges under each card once
   the listings exist. */

export const START_HUB_KEY = "start_hub";

export interface StartHubSettings {
  /** Is the TSLS event app currently in its open season? */
  tslsOpen: boolean;
  /** Shown when closed. */
  closedNote: string;
  /** Store listing URLs — a badge renders only when its URL is set. */
  momentumAppStoreUrl: string;
  momentumPlayUrl: string;
  tslsAppStoreUrl: string;
  tslsPlayUrl: string;
}

export const START_HUB_DEFAULTS: StartHubSettings = {
  tslsOpen: true,
  closedNote:
    "The TSLS App is closed for the season and will reopen before the next event.",
  momentumAppStoreUrl: "",
  momentumPlayUrl: "",
  tslsAppStoreUrl: "",
  tslsPlayUrl: "",
};

export function tslsAppUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_TSLS_EVENT_URL ?? "").replace(/\/$/, "") ||
    "https://thetslsapp.com"
  );
}

export async function readStartHubSettings(): Promise<StartHubSettings> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return START_HUB_DEFAULTS;
  }
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", START_HUB_KEY)
      .maybeSingle();
    const v = (data?.value ?? {}) as Partial<StartHubSettings>;
    return {
      tslsOpen:
        typeof v.tslsOpen === "boolean" ? v.tslsOpen : START_HUB_DEFAULTS.tslsOpen,
      closedNote: v.closedNote?.trim()
        ? v.closedNote
        : START_HUB_DEFAULTS.closedNote,
      momentumAppStoreUrl: v.momentumAppStoreUrl ?? "",
      momentumPlayUrl: v.momentumPlayUrl ?? "",
      tslsAppStoreUrl: v.tslsAppStoreUrl ?? "",
      tslsPlayUrl: v.tslsPlayUrl ?? "",
    };
  } catch {
    return START_HUB_DEFAULTS;
  }
}
