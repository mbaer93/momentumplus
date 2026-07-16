"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  createAccountWithoutEmail,
  findAuthUserIdByEmail,
  planToTier,
  provisionMember,
} from "@/lib/onboarding";
import { requestSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { addMonths } from "@/lib/membership";
import type { Tier } from "@/lib/types";

export interface AdminMemberResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

// The four member levels plus the two special roles. Legacy tiers on
// existing rows stay valid; new grants use these.
const GRANTABLE: Tier[] = ["basic", "gift", "vip", "pro", "speaker", "admin"];

// Gift and VIP are fixed-length comps of the base level.
const FIXED_MONTHS: Partial<Record<Tier, number>> = { gift: 1, vip: 3 };

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
  let manualLoginLink: string | null = null;
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (profile) {
    profileId = profile.id;
  } else {
    const siteUrl = requestSiteUrl();
    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: siteUrl
          ? `${siteUrl}/auth/callback?redirect=/welcome`
          : undefined,
      });
    profileId = invited?.user?.id ?? null;

    if (!profileId) {
      // A login may already exist without a matching profile row (accounts
      // created before profiles were wired, or a hand-edited email). Find
      // it and heal the profile so the grant can proceed.
      const existingId = await findAuthUserIdByEmail(email);
      if (existingId) {
        profileId = existingId;
        await admin
          .from("profiles")
          .upsert({ id: existingId, email }, { onConflict: "id" });
      }
    }

    if (!profileId) {
      // Email system down? Create the login without sending anything and
      // hand the admin a one-time login link to deliver themselves.
      const manual = await createAccountWithoutEmail(email);
      if (manual.profileId) {
        profileId = manual.profileId;
        manualLoginLink = manual.loginLink;
      } else {
        const parts = [
          inviteErr ? `invite failed (${inviteErr.message})` : null,
          manual.error ? `direct account creation failed (${manual.error})` : null,
        ].filter(Boolean);
        return {
          ok: false,
          message: `Couldn't add ${email}: ${parts.join("; ") || "unknown error"}. This points at the auth service itself — tell your developer.`,
        };
      }
    }
  }

  // Duplicate guard: never stack a second active membership of the same
  // tier on an existing account.
  const { data: existingRows } = await admin
    .from("memberships")
    .select("id, tier, status, access_expires_at")
    .eq("profile_id", profileId)
    .eq("status", "active");
  const duplicate = (existingRows ?? []).some(
    (m) =>
      m.tier === input.tier &&
      (!m.access_expires_at || new Date(m.access_expires_at) > new Date()),
  );
  if (duplicate) {
    return {
      ok: false,
      message: `${email} already has an active ${input.tier} membership — nothing added. Use +1 mo on their existing row to extend it.`,
    };
  }

  const now = new Date();
  const months = FIXED_MONTHS[input.tier] ?? input.months;
  const { error } = await admin.from("memberships").insert({
    profile_id: profileId,
    tier: input.tier,
    status: "active",
    access_starts_at: now.toISOString(),
    access_expires_at:
      months > 0 ? addMonths(now, months).toISOString() : null,
    source: "admin",
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  if (manualLoginLink) {
    return {
      ok: true,
      message: `Granted ${input.tier} to ${email} — but the invite email couldn't be sent, so copy this one-time login link and send it to them yourself (it signs them in and asks for a password): ${manualLoginLink}`,
    };
  }
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
  if (!row.access_expires_at) {
    return {
      ok: false,
      message: "This membership is ongoing (no end date) — nothing to extend.",
    };
  }

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

/**
 * Delete a single membership ROW (e.g. an accidental duplicate). The member
 * account, profile, and other memberships are untouched — this is not
 * member deletion.
 */
export async function deleteMembership(
  membershipId: string,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Removed (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };

  const { error } = await createServiceClient()
    .from("memberships")
    .delete()
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/members");
  return { ok: true, message: "Membership row removed." };
}

/**
 * Email the member a password-reset link (for members who can't log in).
 * The link signs them in and lands on the set-password step.
 */
export async function sendPasswordReset(email: string): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Sent (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!email.includes("@")) return { ok: false, message: "No email on this member." };

  const admin = createServiceClient();
  const siteUrl = requestSiteUrl();
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: siteUrl
      ? `${siteUrl}/auth/callback?redirect=/welcome`
      : undefined,
  });
  if (error) return { ok: false, message: `Send failed: ${error.message}` };
  return {
    ok: true,
    message: `Password-reset email sent to ${email} — the link signs them in and asks for a new password.`,
  };
}

/**
 * Mint a one-time login link for a member — no email involved. For when
 * their invite never arrived or email delivery is down: copy the link and
 * send it to them any way you like. It signs them in and asks for a
 * password. Each link replaces the previous one.
 */
export async function getLoginLink(email: string): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Link created (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!email.includes("@")) return { ok: false, message: "No email on this member." };

  const siteUrl = requestSiteUrl();
  const { data, error } = await createServiceClient().auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase(),
    options: {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=/welcome`
        : undefined,
    },
  });
  const hashed = data?.properties?.hashed_token;
  const link = hashed
    ? `${siteUrl ?? ""}/auth/confirm?token_hash=${hashed}&type=recovery&redirect=/welcome`
    : data?.properties?.action_link;
  if (!link) {
    return {
      ok: false,
      message: `Couldn't create a login link: ${error?.message ?? "unknown error"}`,
    };
  }
  return {
    ok: true,
    message: `One-time login link for ${email} — copy and send it to them (signs them in, then asks for a password): ${link}`,
  };
}

/**
 * Change a membership row's tier in place — the everyday way to move a
 * member between levels (Basic → Pro, etc.). Anything touching the admin
 * tier, in either direction, is Super Admin territory.
 */
export async function changeMembershipTier(
  membershipId: string,
  tier: Tier,
): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Changed (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!GRANTABLE.includes(tier)) {
    return { ok: false, message: "Unknown tier." };
  }

  const admin = createServiceClient();
  const { data: row } = await admin
    .from("memberships")
    .select("tier, profile_id, source, access_expires_at")
    .eq("id", membershipId)
    .maybeSingle();
  if (!row) return { ok: false, message: "Membership not found." };
  if (row.source === "stripe") {
    return {
      ok: false,
      message:
        "This membership is billed through Stripe — the member changes plans from Profile → Manage billing so the price and access stay in sync.",
    };
  }

  if ((tier === "admin" || row.tier === "admin") && auth.access.role !== "super") {
    return {
      ok: false,
      message: "Only the Super Admin can change admin access.",
    };
  }
  if (row.tier === "admin" && row.profile_id === auth.userId) {
    return {
      ok: false,
      message: "You can't remove your own admin membership.",
    };
  }

  // Gift/VIP are fixed-length comps — never leave one open-ended.
  const patch: Record<string, unknown> = { tier };
  const fixed = FIXED_MONTHS[tier];
  if (fixed && !row.access_expires_at) {
    patch.access_expires_at = addMonths(new Date(), fixed).toISOString();
  }
  const { error } = await admin
    .from("memberships")
    .update(patch)
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: `Membership level changed to ${tier}.` };
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
