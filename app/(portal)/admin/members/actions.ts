"use server";

import { emailPattern } from "@/lib/db-utils";
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
    .ilike("email", emailPattern(email))
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

  const service = createServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ admin_role: role, admin_perms: perms })
    .eq("id", profileId);
  if (error) return { ok: false, message: error.message };

  const { data: tgt } = await service
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle();
  const { logAdminAction } = await import("@/lib/admin-audit");
  await logAdminAction({
    actorId: auth.userId,
    actorEmail: auth.userEmail,
    action: "set_admin_access",
    targetProfileId: profileId,
    targetEmail: (tgt?.email as string | null) ?? null,
    detail: `role=${role}`,
  });

  revalidatePath("/admin/members");
  return { ok: true, message: "Admin access updated." };
}

/**
 * Super Admin only: permanently delete a member. In-database records go via
 * FK cascade from the auth user; this also cancels their Stripe billing,
 * erases their Stream chat identity + messages, and scrubs their email from
 * the import ledger — so a deletion request leaves nothing behind that would
 * keep charging them or hold their PII. Irreversible.
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

  // Gather external references BEFORE the cascade removes them.
  const { data: profile } = await admin
    .from("profiles")
    .select("email, stripe_customer_id")
    .eq("id", profileId)
    .maybeSingle();
  const { data: subs } = await admin
    .from("memberships")
    .select("stripe_subscription_id")
    .eq("profile_id", profileId)
    .not("stripe_subscription_id", "is", null);

  const notes: string[] = [];

  // 1. Cancel any live Stripe subscription so a deleted member is never
  //    billed again, then delete the customer record (removes stored PII).
  try {
    const { getStripeSettings, stripeReady, stripeRequest } = await import("@/lib/stripe");
    const settings = await getStripeSettings();
    if (stripeReady(settings)) {
      for (const s of subs ?? []) {
        const id = s.stripe_subscription_id as string;
        await stripeRequest(settings.secretKey, "DELETE", `/subscriptions/${id}`).catch(
          () => notes.push("a Stripe subscription may need manual cancellation"),
        );
      }
      if (profile?.stripe_customer_id) {
        await stripeRequest(
          settings.secretKey,
          "DELETE",
          `/customers/${profile.stripe_customer_id}`,
        ).catch(() => notes.push("the Stripe customer may need manual deletion"));
      }
    } else if ((subs ?? []).length > 0) {
      notes.push("Stripe isn't connected — cancel their subscription manually");
    }
  } catch {
    notes.push("Stripe cleanup failed — check their subscription manually");
  }

  // 2. Erase their Stream chat identity and messages.
  try {
    const { deleteStreamUser } = await import("@/lib/stream");
    await deleteStreamUser(profileId);
  } catch {
    notes.push("Stream chat records may need manual removal");
  }

  // 3. Scrub their email from the TSLS import ledger (cascade only nulls
  //    profile_id, leaving the address behind).
  if (profile?.email) {
    const { error: scrubError } = await admin
      .from("import_log")
      .delete()
      .ilike("email", emailPattern(profile.email));
    if (scrubError) notes.push("import-log rows may retain their email");
  }

  // 4. Delete the auth user (cascades all in-DB member data) + profile.
  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, message: error.message };
  await admin.from("profiles").delete().eq("id", profileId);

  const { logAdminAction } = await import("@/lib/admin-audit");
  await logAdminAction({
    actorId: auth.userId,
    actorEmail: auth.userEmail,
    action: "delete_member",
    targetProfileId: profileId,
    targetEmail: profile?.email ?? null,
    detail: notes.length > 0 ? notes.join("; ") : "Full deletion",
  });

  revalidatePath("/admin/members");
  return {
    ok: true,
    message:
      notes.length > 0
        ? `Member deleted. Note: ${notes.join("; ")}. Their GHL contact is not removed automatically — delete it in GHL if required.`
        : "Member deleted permanently. Stripe billing cancelled and chat records erased. (Their GHL contact is not removed automatically — delete it in GHL if required.)",
  };
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

  const admin = createServiceClient();
  const guardMsg = await guardAdminRow(admin, membershipId, auth);
  if (guardMsg) return { ok: false, message: guardMsg };

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/members");
  return { ok: true, message: "Membership row removed." };
}

/**
 * Admin-tier rows are Super Admin territory in BOTH directions — a standard
 * admin must not be able to expire or delete another admin's (or the Super
 * Admin's) access, and nobody removes their own admin row by accident.
 */
async function guardAdminRow(
  admin: ReturnType<typeof createServiceClient>,
  membershipId: string,
  auth: { userId: string; access: { role: string } },
): Promise<string | null> {
  const { data: row } = await admin
    .from("memberships")
    .select("tier, profile_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!row) return "Membership not found.";
  if (row.tier !== "admin") return null;
  if (auth.access.role !== "super") {
    return "Only the Super Admin can remove admin access.";
  }
  if (row.profile_id === auth.userId) {
    return "You can't remove your own admin access — ask another Super Admin.";
  }
  return null;
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
 * Re-send the branded invite email to a member who has never logged in.
 * Supabase re-invites unconfirmed accounts; if the account somehow can't be
 * re-invited (e.g. it was confirmed between page load and click), fall back
 * to the password-reset email so the member still gets a working link.
 */
export async function resendInvite(email: string): Promise<AdminMemberResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invite re-sent (preview mode)." };
  }
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!email.includes("@")) return { ok: false, message: "No email on this member." };

  const admin = createServiceClient();
  const siteUrl = requestSiteUrl();
  const redirectTo = siteUrl ? `${siteUrl}/auth/callback?redirect=/welcome` : undefined;
  const { error } = await admin.auth.admin.inviteUserByEmail(
    email.trim().toLowerCase(),
    { redirectTo },
  );
  if (!error) {
    return { ok: true, message: `Invite email re-sent to ${email}.` };
  }
  const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (resetError) {
    return { ok: false, message: `Couldn't re-send: ${error.message}` };
  }
  return {
    ok: true,
    message: `${email} already accepted their invite, so we sent a sign-in (password reset) email instead.`,
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
  // This mints a token that signs the operator in AS the member (and can
  // reach their private notes), so it is Super-Admin-only, never targets
  // another admin, and every use is recorded in the audit log.
  const auth = await requireAdmin("members");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.access.role !== "super") {
    return {
      ok: false,
      message:
        "Only the Super Admin can mint a one-time login link. Use “Send password reset” instead — it emails the link to the member.",
    };
  }
  if (!email.includes("@")) return { ok: false, message: "No email on this member." };

  const normalized = email.trim().toLowerCase();
  const admin = createServiceClient();

  // Never mint a login link that would impersonate another admin.
  const { data: target } = await admin
    .from("profiles")
    .select("id, admin_role, memberships ( tier, status )")
    .ilike("email", emailPattern(normalized))
    .maybeSingle();
  const targetIsAdmin =
    target?.admin_role != null ||
    (
      target as unknown as {
        memberships?: { tier: string; status: string }[];
      } | null
    )?.memberships?.some((m) => m.tier === "admin" && m.status === "active");
  if (targetIsAdmin) {
    return {
      ok: false,
      message: "Login links can't be minted for admin accounts.",
    };
  }

  const siteUrl = requestSiteUrl();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: normalized,
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

  const { logAdminAction } = await import("@/lib/admin-audit");
  await logAdminAction({
    actorId: auth.userId,
    actorEmail: auth.userEmail,
    action: "login_link",
    targetProfileId: target?.id ?? null,
    targetEmail: normalized,
    detail: "One-time sign-in link minted",
  });

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
  const guardMsg = await guardAdminRow(admin, membershipId, auth);
  if (guardMsg) return { ok: false, message: guardMsg };

  const { error } = await admin
    .from("memberships")
    .update({ status: "expired", access_expires_at: new Date().toISOString() })
    .eq("id", membershipId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "Membership expired." };
}
