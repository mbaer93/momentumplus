import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * The "Presented by" logo is a single site-wide slot (there is exactly one
 * Momentum+ Sponsor at a time), stored at a fixed path in the public
 * sponsor-logos bucket rather than on a sponsor row. Uploading for a new
 * sponsor simply replaces it.
 */

export const PRESENTED_BY_PATH = "presented-by/logo";

/** Public URL of the uploaded presented-by logo, or null if none exists. */
export async function getPresentedByLogoUrl(): Promise<string | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    const admin = createServiceClient();
    const { data } = await admin.storage
      .from("sponsor-logos")
      .list("presented-by", { search: "logo" });
    const obj = data?.find((o) => o.name === "logo");
    if (!obj) return null;
    const { data: pub } = admin.storage
      .from("sponsor-logos")
      .getPublicUrl(PRESENTED_BY_PATH);
    // Cache-bust on the storage object's updated_at so replacements show.
    const v = obj.updated_at ? new Date(obj.updated_at).getTime() : 0;
    return `${pub.publicUrl}?v=${v}`;
  } catch {
    return null;
  }
}
