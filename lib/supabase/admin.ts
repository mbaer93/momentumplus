import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/*
 * Service-role Supabase client. Bypasses RLS — use ONLY in trusted server
 * contexts (webhooks, imports, cron, admin mutations) and NEVER expose the
 * service-role key to the client (CLAUDE.md non-negotiable #5, SPEC.md §3).
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) {
    throw new Error("Supabase service-role credentials are not configured");
  }
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
