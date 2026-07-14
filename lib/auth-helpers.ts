import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Server-side admin check: true only if the signed-in user holds an active
 * admin-tier membership. Mirrors the DB is_admin() helper; used to gate admin
 * routes and mutations before touching the service-role client.
 */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; status: number; message: string }
> {
  if (!isSupabaseConfigured()) {
    // Preview mode: no real auth. Admin actions are no-ops elsewhere.
    return { ok: false, status: 503, message: "Supabase is not configured." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, message: "Not signed in." };

  const { data, error } = await supabase
    .from("memberships")
    .select("id")
    .eq("profile_id", user.id)
    .eq("tier", "admin")
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 403, message: "Admin access required." };
  }
  return { ok: true, userId: user.id };
}
