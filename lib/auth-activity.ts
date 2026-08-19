import { createServiceClient } from "@/lib/supabase/admin";

/*
 * Invite / sign-in timestamps out of the Supabase auth layer, keyed by user
 * id (= profile id).
 *
 * Lifted out of Admin → Members (2026-08-19) so Admin → Speakers can answer
 * the same question about a pending invite: "opened it and stalled" and
 * "never touched it" look identical on the invite row alone, and Matt was
 * chasing speakers who had in fact already signed in.
 */

export interface AuthActivity {
  invitedAt: string | null;
  confirmedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export async function fetchAuthActivity(
  profileIds: string[],
): Promise<Map<string, AuthActivity>> {
  const admin = createServiceClient();
  const byId = new Map<string, AuthActivity>();
  if (profileIds.length === 0) return byId;

  // One RPC scoped to exactly the displayed profiles (migration 0024) —
  // this page used to walk the ENTIRE auth user list, up to 20 sequential
  // Auth-admin API calls per view.
  const { data: rpcRows, error: rpcError } = await admin.rpc("auth_activity", {
    ids: profileIds,
  });
  if (!rpcError && rpcRows) {
    for (const u of rpcRows as {
      id: string;
      invited_at: string | null;
      confirmed_at: string | null;
      last_sign_in_at: string | null;
      created_at: string | null;
    }[]) {
      byId.set(u.id, {
        invitedAt: u.invited_at ?? null,
        confirmedAt: u.confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at ?? null,
      });
    }
    return byId;
  }

  // Fallback until the migration is applied: page the auth list.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      byId.set(u.id, {
        invitedAt: u.invited_at ?? null,
        confirmedAt: u.email_confirmed_at ?? u.confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at ?? null,
      });
    }
    if (data.users.length < 1000) break;
  }
  return byId;
}
