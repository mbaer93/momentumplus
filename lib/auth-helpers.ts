import { canAccessArea, type AdminAccess, type AdminArea } from "@/lib/admin-perms";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { readViewAsCookie } from "@/lib/view-as";

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
  | { ok: true; userId: string; userEmail: string | null; access: AdminAccess }
  | { ok: false; status: number; message: string }
> {
  // While a Super Admin is viewing as a member, the Admin Panel has to be as
  // out of reach as it is for that member — otherwise the preview lies about
  // the one thing it exists to show. Leaving the preview goes through
  // realAdminAccess() below, which ignores the cookie.
  const viewingAs = await readViewAsCookie();
  if (viewingAs && viewingAs !== "admin") {
    return {
      ok: false,
      status: 403,
      message: "You're viewing the portal as a member. Exit the preview first.",
    };
  }
  return requireRealAdmin(area);
}

/**
 * The admin check WITHOUT the view-as override — who this person actually is.
 * Only the code that enters and leaves a preview should use it; everything
 * else wants requireAdmin().
 */
export async function requireRealAdmin(area?: AdminArea): Promise<
  | { ok: true; userId: string; userEmail: string | null; access: AdminAccess }
  | { ok: false; status: number; message: string }
> {
  if (!isSupabaseConfigured()) {
    // Preview mode: no real auth. Admin actions are no-ops elsewhere.
    return { ok: false, status: 503, message: "Supabase is not configured." };
  }

  const supabase = await createClient();
  const user = await getAuthUser();
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

  return { ok: true, userId: user.id, userEmail: user.email ?? null, access };
}

/**
 * Page-level helper: the signed-in admin's access (null if not an admin).
 * Used to hide admin hub cards for areas a standard admin can't touch —
 * the real enforcement stays in requireAdmin(area) on every mutation.
 */
export async function getAdminAccess(): Promise<AdminAccess | null> {
  // Preview-mode "everyone is super admin" is a local-dev convenience only;
  // on a deployed environment an unconfigured Supabase must not mint admin.
  // Gate on NODE_ENV too, not just VERCEL — a self-hosted production build
  // without the Vercel env var must fail closed the same way (audit P2-21).
  // ALLOW_UNCONFIGURED_PREVIEW opts a deliberate credential-free preview
  // build back in (`next start` always sets NODE_ENV=production, so the e2e
  // suite's preview build would otherwise lose admin entirely). A deployment
  // that merely forgot its Supabase env still fails closed.
  if (!isSupabaseConfigured()) {
    return (process.env.VERCEL || process.env.NODE_ENV === "production") &&
      !process.env.ALLOW_UNCONFIGURED_PREVIEW
      ? null
      : { role: "super", perms: {} };
  }
  const res = await requireAdmin();
  return res.ok ? res.access : null;
}
