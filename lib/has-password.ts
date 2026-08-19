import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Has this account set a password yet? (migration 0095)
 *
 * The setup forms used to ask whenever the INVITE had created the account,
 * which is a different question — Rob set a password through a recovery
 * link, was routed straight into speaker setup, and was asked to choose one
 * again on the very next screen (2026-08-19).
 *
 * Fails CLOSED to "yes, they have one", so an error here HIDES the password
 * fields rather than demanding a second password. Someone who genuinely has
 * none can still set one from Forgot password; someone who has one being
 * told to replace it is the bug being fixed.
 */
export async function hasPassword(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }
  const { data, error } = await createServiceClient().rpc("auth_has_password", {
    ids: [userId],
  });
  // Pre-migration the function does not exist. Treating that as "has one"
  // keeps the old double-ask from coming back while 0095 is unapplied.
  if (error) return true;
  const row = (data as { id: string; has_password: boolean }[] | null)?.[0];
  return row?.has_password !== false;
}
