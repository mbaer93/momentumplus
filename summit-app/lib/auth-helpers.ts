import { getCurrentMember } from "./current-member";
import { isSupabaseConfigured } from "./supabase/config";

/*
 * Admin gate for server actions and admin pages. Unlike Momentum+ there are
 * no per-area permissions here — the summit team is small; you're either an
 * event admin or you're not. The optional area argument is accepted (and
 * ignored) so calling code reads the same as the portal's.
 */
export async function requireAdmin(_area?: string): Promise<
  | { ok: true; userId: string; userEmail: string | null }
  | { ok: false; status: number; message: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, message: "Supabase is not configured." };
  }
  const member = await getCurrentMember();
  if (!member) {
    return { ok: false, status: 401, message: "Not signed in." };
  }
  if (!member.isAdmin) {
    return { ok: false, status: 403, message: "Admin access required." };
  }
  return { ok: true, userId: member.id, userEmail: member.email };
}
