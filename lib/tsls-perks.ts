import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requestCache } from "@/lib/request-cache";

/*
 * TSLS member perks (Matt, 2026-07-29): active Momentum+ members get a
 * discount path to next year's summit tickets. The offer (headline, code,
 * link) is admin-edited on Admin → Billing and rendered as a dashboard
 * card for members while enabled.
 */

export const TSLS_PERKS_KEY = "tsls_perks";

export interface TslsPerks {
  enabled: boolean;
  /** e.g. "Members save 20% on TSLS 2027 tickets" */
  headline: string;
  blurb: string;
  /** Discount code to use at checkout ("" = the link itself carries it). */
  code: string;
  /** Ticket purchase link. */
  url: string;
}

export const TSLS_PERKS_DEFAULTS: TslsPerks = {
  enabled: false,
  headline: "",
  blurb: "",
  code: "",
  url: "",
};

export function mergeTslsPerks(
  stored: Partial<TslsPerks> | null | undefined,
): TslsPerks {
  const merged = { ...TSLS_PERKS_DEFAULTS, ...(stored ?? {}) };
  merged.enabled = merged.enabled === true;
  return merged;
}

/* requestCache(): the dashboard and admin page can both ask per request. */
export const getTslsPerks = requestCache(async (): Promise<TslsPerks> => {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return TSLS_PERKS_DEFAULTS;
  }
  const { data } = await createServiceClient()
    .from("app_settings")
    .select("value")
    .eq("key", TSLS_PERKS_KEY)
    .maybeSingle();
  return mergeTslsPerks((data?.value as Partial<TslsPerks> | undefined) ?? null);
});

export async function saveTslsPerks(value: TslsPerks): Promise<void> {
  await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: TSLS_PERKS_KEY, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}
