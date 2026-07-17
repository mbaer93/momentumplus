/*
 * Admin audit trail — an accountable record of sensitive admin actions
 * (minting login links, deleting members, changing admin access). Writes go
 * through the service role; reads are super-admin only (RLS, migration 0023).
 */

import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface AdminAuditEntry {
  /** Null for system-initiated entries (e.g. the Stripe webhook). */
  actorId: string | null;
  actorEmail?: string | null;
  action: string;
  targetProfileId?: string | null;
  targetEmail?: string | null;
  detail?: string | null;
}

/** Record an admin action. Best-effort — never blocks the action itself. */
export async function logAdminAction(entry: AdminAuditEntry): Promise<void> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await createServiceClient().from("admin_audit_log").insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_profile_id: entry.targetProfileId ?? null,
      target_email: entry.targetEmail ?? null,
      detail: entry.detail ?? null,
    });
  } catch {
    // Auditing must not break the operation it records.
  }
}

export interface AdminAuditRow {
  actorEmail: string;
  action: string;
  actionLabel: string;
  targetEmail: string;
  detail: string;
  at: string;
}

const ACTION_LABELS: Record<string, string> = {
  login_link: "Minted a login link",
  delete_member: "Deleted a member",
  set_admin_access: "Changed admin access",
  grant_admin: "Granted admin",
  change_to_admin: "Changed member to admin",
  invite_email_failed: "Invite email failed (needs re-send)",
};

/** Recent admin actions for the super-admin audit page. */
export async function listAdminAudit(limit = 200): Promise<AdminAuditRow[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const { data } = await createServiceClient()
    .from("admin_audit_log")
    .select("actor_email, action, target_email, detail, at")
    .order("at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    actorEmail: (r.actor_email as string) || "—",
    action: r.action as string,
    actionLabel: ACTION_LABELS[r.action as string] ?? (r.action as string),
    targetEmail: (r.target_email as string) || "—",
    detail: (r.detail as string) || "",
    at: r.at as string,
  }));
}
