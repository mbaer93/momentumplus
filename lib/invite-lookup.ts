import type { createServiceClient } from "@/lib/supabase/admin";
import { emailPattern } from "@/lib/db-utils";

/*
 * Speaker/sponsor invites are matched to the signed-in account by profile id
 * OR email — every reader must use the SAME rule. They didn't: the /welcome
 * and /expired self-heals matched by email while the onboarding pages
 * matched by profile id only, so an invite whose auth account was later
 * recreated (or created under a different id) bounced the person to an
 * onboarding page that said "no pending setup", whose only button bounced
 * them back — an endless loop with no way into the portal.
 */
export async function findOpenInvite<T extends { id: string }>(
  admin: ReturnType<typeof createServiceClient>,
  table: "speaker_invites" | "sponsor_invites",
  user: { id: string; email?: string | null },
  columns = "id",
): Promise<T | null> {
  const base = () =>
    admin
      .from(table)
      .select(columns)
      .is("completed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
  const { data: byProfile } = await base()
    .eq("invited_profile_id", user.id)
    .maybeSingle();
  if (byProfile) return byProfile as unknown as T;
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  const { data: byEmail } = await base()
    .ilike("email", emailPattern(email))
    .maybeSingle();
  return (byEmail as unknown as T) ?? null;
}
