import { canAccessArea, type AdminAccess, type AdminArea } from "@/lib/admin-perms";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Server-side admin check: true only if the signed-in user holds an active
 * admin-tier membership. Mirrors the DB is_admin() helper; used to gate admin
 * routes and mutations before touching the service-role client.
 *
 * Pass an `area` to additionally enforce per-admin permissions: the Super
 * Admin always passes; standard admins pass unless the super admin has
 * switched that area off for them.
 */
export async function requireAdmin(area?: AdminArea): Promise<
  | { ok: true; userId: string; access: AdminAccess }
  | { ok: false; status: number; message: string }
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

  const [{ data: membership, error }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id")
      .eq("profile_id", user.id)
      .eq("tier", "admin")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("admin_role, admin_perms")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (error || !membership) {
    return { ok: false, status: 403, message: "Admin access required." };
  }

  const access: AdminAccess = {
    role: profile?.admin_role === "super" ? "super" : "standard",
    perms: (profile?.admin_perms as Record<string, boolean> | null) ?? {},
  };

  if (area && !canAccessArea(access, area)) {
    return {
      ok: false,
      status: 403,
      message:
        "You don't have access to this area — ask the Super Admin to enable it for you.",
    };
  }

  return { ok: true, userId: user.id, access };
}

/**
 * Page-level helper: the signed-in admin's access (null if not an admin).
 * Used to hide admin hub cards for areas a standard admin can't touch —
 * the real enforcement stays in requireAdmin(area) on every mutation.
 */
export async function getAdminAccess(): Promise<AdminAccess | null> {
  if (!isSupabaseConfigured()) return { role: "super", perms: {} };
  const res = await requireAdmin();
  return res.ok ? res.access : null;
}
