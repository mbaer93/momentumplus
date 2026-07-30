import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Durable per-member rate limiting backed by action_events (migration
 * 0071). The previous help-chat limiter was an in-process Map — on
 * serverless that resets on every cold start and never sees sibling
 * instances, so its cap was advisory. This one survives both.
 *
 * Fail-open by design: if the ledger can't be read the action proceeds —
 * a rate limiter must never take a feature down with it.
 */

export async function allowAction(
  profileId: string,
  action: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }
  try {
    const admin = createServiceClient();
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await admin
      .from("action_events")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("action", action)
      .gte("created_at", since);
    if (error) return true; // pre-0071 or transient — never block on it
    if ((count ?? 0) >= max) return false;
    await admin.from("action_events").insert({ profile_id: profileId, action });
    return true;
  } catch {
    return true;
  }
}
