"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { addMonths } from "@/lib/membership";
import type { Tier } from "@/lib/types";

export interface AdminMemberResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

const GRANTABLE: Tier[] = [
  "tsls_attendee",
  "tsls_vip",
  "sub_3mo",
  "sub_6mo",
  "sub_monthly",
  "sub_annual",
  "speaker",
  "admin",
];

/**
 * Admin: grant a membership by email (source=admin). Invites the member if
 * they don't exist yet. months=0 → ongoing (speaker/admin).
 */
export async function grantMembership(input: {
  email: string;
  tier: Tier;
  months: number;
}): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Granted (preview mode)." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!GRANTABLE.includes(input.tier)) {
    return { ok: false, message: "Unknown tier." };
  }

  const email = input.email.trim().toLowerCase();
  const admin = createServiceClient();

  let profileId: string | null = null;
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (profile) {
    profileId = profile.id;
  } else {
    const { data: invited } = await admin.auth.admin.inviteUserByEmail(email);
    profileId = invited?.user?.id ?? null;
  }
  if (!profileId) {
    return { ok: false, message: "Could not find or invite that email." };
  }

  const now = new Date();
  const { error } = await admin.from("memberships").insert({
    profile_id: profileId,
    tier: input.tier,
    status: "active",
    access_starts_at: now.toISOString(),
    access_expires_at:
      input.months > 0 ? addMonths(now, input.months).toISOString() : null,
    source: "admin",
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: `Granted ${input.tier} to ${email}.` };
}

export async function extendMembership(
  membershipId: string,
  months: number,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Extended (preview mode)." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: row } = await admin
    .from("memberships")
    .select("access_expires_at")
    .eq("id", membershipId)
    .maybeSingle();
  if (!row) return { ok: false, message: "Membership not found." };

  const base =
    row.access_expires_at && new Date(row.access_expires_at) > new Date()
      ? new Date(row.access_expires_at)
      : new Date();
  const { error } = await admin
    .from("memberships")
    .update({
      status: "active",
      access_expires_at: addMonths(base, months).toISOString(),
    })
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: `Extended ${months} month(s).` };
}

export async function expireMembership(
  membershipId: string,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Expired (preview mode)." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { error } = await admin
    .from("memberships")
    .update({ status: "expired", access_expires_at: new Date().toISOString() })
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "Membership expired." };
}
