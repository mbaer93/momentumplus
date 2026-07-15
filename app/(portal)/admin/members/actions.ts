"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { planToTier, provisionMember } from "@/lib/onboarding";
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
  "basic",
  "gift",
  "vip",
  "pro",
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
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!GRANTABLE.includes(input.tier)) {
    return { ok: false, message: "Unknown tier." };
  }
  // Only the Super Admin can mint new admins.
  if (input.tier === "admin" && auth.access.role !== "super") {
    return {
      ok: false,
      message: "Only the Super Admin can grant admin access.",
    };
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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { data: invited } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=/welcome`
        : undefined,
    });
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

/** Admin: edit a member's profile details (name shown across the portal). */
export async function updateMemberProfile(
  profileId: string,
  input: { fullName: string; title: string; company: string; phone: string },
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!input.fullName.trim()) {
    return { ok: false, message: "Name can't be empty." };
  }

  const { error } = await createServiceClient()
    .from("profiles")
    .update({
      full_name: input.fullName.trim(),
      title: input.title.trim() || null,
      company: input.company.trim() || null,
      phone: input.phone.trim() || null,
    })
    .eq("id", profileId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "Member profile saved." };
}

/**
 * Super Admin only: set another admin's role and per-area permissions.
 * Areas default to allowed — unchecking removes access; enforcement is in
 * requireAdmin(area) on every admin mutation.
 */
export async function setAdminAccess(
  profileId: string,
  role: "super" | "standard",
  perms: Record<string, boolean>,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return {
      ok: false,
      message: "Only the Super Admin can manage admin access.",
    };
  }
  if (profileId === auth.userId && role !== "super") {
    return {
      ok: false,
      message: "You can't remove your own Super Admin role.",
    };
  }

  const { error } = await createServiceClient()
    .from("profiles")
    .update({ admin_role: role, admin_perms: perms })
    .eq("id", profileId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "Admin access updated." };
}

/**
 * Super Admin only: permanently delete a member — their login, profile,
 * memberships, enrollments, notes, and progress all go (FK cascades from
 * the auth user). Irreversible.
 */
export async function deleteMember(profileId: string): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Deleted (preview mode)." };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return { ok: false, message: "Only the Super Admin can delete members." };
  }
  if (profileId === auth.userId) {
    return { ok: false, message: "You can't delete your own account." };
  }

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, message: error.message };
  // Belt-and-braces: remove the profile row if any remnant survived.
  await admin.from("profiles").delete().eq("id", profileId);

  revalidatePath("/admin/members");
  return { ok: true, message: "Member deleted permanently." };
}

export interface BulkResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
  results?: string[];
}

/**
 * Bulk member import: one line per member —
 *   email, Full Name, plan
 * Plans: basic, gift, vip, pro, monthly, 3month, 6month, 12month/annual,
 * attendee, speaker.
 * New emails get an invite (lands on /welcome to set a password); repeats
 * are idempotent.
 */
export async function bulkAddMembers(csv: string): Promise<BulkResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Imported (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"))
    // Tolerate a pasted header row.
    .filter((l, i) => !(i === 0 && /^email\s*[,\t]/i.test(l)));

  if (lines.length === 0) {
    return { ok: false, message: "Paste at least one line: email, name, plan" };
  }
  if (lines.length > 200) {
    return {
      ok: false,
      message: `That's ${lines.length} lines — import at most 200 at a time.`,
    };
  }

  const results: string[] = [];
  let okCount = 0;
  for (const line of lines) {
    const [email = "", name = "", plan = ""] = line
      .split(/[,\t]/)
      .map((p) => p.trim());
    const mapping = planToTier(plan);
    if (!mapping) {
      results.push(
        `${email || line}: unknown plan "${plan}" — use basic, gift, vip, pro, monthly, 3month, 6month, 12month, annual, attendee, or speaker.`,
      );
      continue;
    }
    const res = await provisionMember({
      email,
      name,
      tier: mapping.tier,
      months: mapping.months,
      source: "admin",
    });
    results.push(res.message ?? `${email}: done.`);
    if (res.ok) okCount++;
  }

  revalidatePath("/admin/members");
  return {
    ok: okCount > 0,
    message: `${okCount} of ${lines.length} processed successfully.`,
    results,
  };
}

export async function extendMembership(
  membershipId: string,
  months: number,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Extended (preview mode)." };
  }
  const auth = await requireAdmin("members");
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
  const auth = await requireAdmin("members");
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
