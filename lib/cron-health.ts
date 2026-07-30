import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Cron heartbeat journal (audit: with CRON_SECRET unset or a schedule
 * misconfigured, every scheduled route fails closed and SILENTLY — nothing
 * anywhere showed whether the crons were alive). Each cron stamps its last
 * successful run into one app_settings row; Admin → Connections renders it.
 * Best-effort by design: a heartbeat failure must never fail the cron.
 */

export interface CronRun {
  at: string;
  note?: string;
}

export type CronHealth = Record<string, CronRun>;

export async function recordCronRun(
  name: string,
  note?: string,
): Promise<void> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "cron_health")
      .maybeSingle();
    const health = ((data?.value as CronHealth | null) ?? {}) as CronHealth;
    health[name] = {
      at: new Date().toISOString(),
      ...(note ? { note: note.slice(0, 200) } : {}),
    };
    await admin.from("app_settings").upsert(
      {
        key: "cron_health",
        value: health,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    /* heartbeat only */
  }
}

export async function readCronHealth(): Promise<CronHealth> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {};
  }
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", "cron_health")
      .maybeSingle();
    return ((data?.value as CronHealth | null) ?? {}) as CronHealth;
  } catch {
    return {};
  }
}
