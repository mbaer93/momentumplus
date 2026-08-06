import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Durable per-member rate limiting backed by action_events (migration
 * 0071). The previous help-chat limiter was an in-process Map — on
 * serverless that resets on every cold start and never sees sibling
 * instances, so its cap was advisory. This one survives both.
 *
 * Fail-open by design: if the ledger can't be read the action proceeds —
 * a rate limiter must never take a feature down with it. But not open
 * WIDE (audit P2-21): while the ledger is failing, a per-instance memory
 * counter still enforces the cap, so a DB outage can't be leveraged into
 * an unlimited-requests window.
 */

const memoryLedger = new Map<string, number[]>();

function memoryAllow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (memoryLedger.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    memoryLedger.set(key, hits);
    return false;
  }
  hits.push(now);
  memoryLedger.set(key, hits);
  // Unbounded key growth guard — the map only matters during an outage.
  if (memoryLedger.size > 10_000) memoryLedger.clear();
  return true;
}

export async function allowAction(
  profileId: string,
  action: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }
  const memKey = `${profileId}:${action}`;
  try {
    const admin = createServiceClient();
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await admin
      .from("action_events")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("action", action)
      .gte("created_at", since);
    if (error) return memoryAllow(memKey, max, windowMs); // pre-0071 or transient
    if ((count ?? 0) >= max) return false;
    await admin.from("action_events").insert({ profile_id: profileId, action });
    return true;
  } catch {
    return memoryAllow(memKey, max, windowMs);
  }
}
