import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Invite-only session helpers (migration 0059). Admin-side reads: the
 * member picker in the session form and an existing session's roster.
 * Only ever called from admin pages — requireAdmin guards the routes.
 */

export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

/** Every profile, alphabetical — the pool the roster picker chooses from. */
export async function listMemberOptions(): Promise<MemberOption[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { data } = await createServiceClient()
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name");
  return (data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.full_name ?? ""),
    email: String(p.email ?? ""),
  }));
}

/** Profile ids invited to a session (empty for open sessions). */
export async function listInviteeIds(sessionId: string): Promise<string[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { data, error } = await createServiceClient()
    .from("session_invitees")
    .select("profile_id")
    .eq("session_id", sessionId);
  // Pre-0059 the table doesn't exist — an open session is the right answer.
  if (error) return [];
  return (data ?? []).map((r) => String(r.profile_id));
}
