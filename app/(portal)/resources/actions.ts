"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Record a resource use (resource_uses — SPEC.md §3). RLS: own rows only. */
export async function recordResourceUse(resourceId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("resource_uses")
    .insert({ resource_id: resourceId, profile_id: user.id });
}
