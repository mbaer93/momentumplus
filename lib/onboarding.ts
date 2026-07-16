import { addMonths } from "@/lib/membership";
import { requestSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/admin";
import type { Tier } from "@/lib/types";

/*
 * Shared member provisioning used by the Zapier webhook, the admin bulk
 * importer, and (pattern-wise) the TSLS sheet import:
 *   email → invite via Supabase (magic-link email → /welcome to set a
 *   password) or find the existing profile → upsert profile name →
 *   insert membership (skipping exact duplicates so retries are safe).
 */

export interface ProvisionInput {
  email: string;
  name?: string;
  tier: Tier;
  /** Access length; 0/null = ongoing (speaker/admin-style grants). */
  months: number | null;
  source: string;
}

export interface ProvisionResult {
  ok: boolean;
  email: string;
  /** A brand-new account was created and an invite email sent. */
  invited: boolean;
  /** An equivalent active membership already existed; nothing inserted. */
  alreadyActive: boolean;
  message?: string;
}

/**
 * Friendly plan names (Zapier fields, CSV columns) → tier + months.
 * Mirrors the confirmed pricing plans plus TSLS registration tiers.
 */
export function planToTier(plan: string): { tier: Tier; months: number } | null {
  const p = plan.trim().toLowerCase().replace(/[\s_\-+]/g, "");
  switch (p) {
    case "monthly":
    case "submonthly":
    case "1month":
    case "month":
      return { tier: "sub_monthly", months: 1 };
    case "3month":
    case "3months":
    case "3mo":
    case "sub3mo":
    case "quarterly":
      return { tier: "sub_3mo", months: 3 };
    case "6month":
    case "6months":
    case "6mo":
    case "sub6mo":
      return { tier: "sub_6mo", months: 6 };
    case "12month":
    case "12months":
    case "12mo":
    case "annual":
    case "subannual":
    case "yearly":
    case "1year":
      return { tier: "sub_annual", months: 12 };
    case "attendee":
    case "tslsattendee":
      return { tier: "tsls_attendee", months: 12 };
    case "tslsvip":
      return { tier: "tsls_vip", months: 12 };
    // Member levels (July 2026): basic paid; gift = free Basic 1 month;
    // vip = free Basic-level 3 months; pro = everything.
    case "basic":
    case "basicuser":
      return { tier: "basic", months: 1 };
    case "gift":
    case "giftuser":
      return { tier: "gift", months: 1 };
    case "vip":
    case "vipuser":
      return { tier: "vip", months: 3 };
    case "pro":
    case "prouser":
      return { tier: "pro", months: 1 };
    case "speaker":
      return { tier: "speaker", months: 0 };
    default:
      return null;
  }
}

/**
 * Find an existing login by email even when its profiles row is missing or
 * carries a different email (accounts created before profiles were wired,
 * or edited by hand). Pages through auth users; fine at community scale.
 */
export async function findAuthUserIdByEmail(
  email: string,
): Promise<string | null> {
  const admin = createServiceClient();
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === target,
    );
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Email-proof account creation: when the invite email can't be sent (SMTP
 * outage, rate limit, provider hiccup), create the login directly — no
 * email involved — and mint a one-time login link the admin can hand to
 * the member themselves. The grant must never fail because email did.
 */
export async function createAccountWithoutEmail(
  email: string,
  name?: string,
): Promise<{ profileId: string | null; loginLink: string | null; error: string | null }> {
  const admin = createServiceClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: name?.trim() ? { full_name: name.trim() } : undefined,
  });
  if (!created?.user) {
    return {
      profileId: null,
      loginLink: null,
      error: createErr?.message ?? "Could not create the account.",
    };
  }

  const siteUrl = requestSiteUrl();
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: siteUrl ? `${siteUrl}/auth/callback?redirect=/welcome` : undefined,
    },
  });
  const hashed = linkData?.properties?.hashed_token;
  return {
    profileId: created.user.id,
    loginLink: hashed
      ? `${siteUrl ?? ""}/auth/confirm?token_hash=${hashed}&type=recovery&redirect=/welcome`
      : (linkData?.properties?.action_link ?? null),
    error: null,
  };
}

export async function provisionMember(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const base: Omit<ProvisionResult, "ok" | "message"> = {
    email,
    invited: false,
    alreadyActive: false,
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ...base, ok: false, message: "Not a valid email address." };
  }

  const admin = createServiceClient();
  let profileId: string | null = null;
  let invited = false;
  let inviteFailure: string | null = null;
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
    const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.name ?? "" },
      redirectTo: siteUrl ? `${siteUrl}/auth/callback?redirect=/welcome` : undefined,
    });
    if (inv?.user) {
      profileId = inv.user.id;
      invited = true;
    } else if (error) {
      inviteFailure = error.message;
      // Auth user may exist without a profile row yet (invite race) — retry.
      const { data: again } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      profileId = again?.id ?? null;
      // Login may exist with no profile row at all (accounts created before
      // profiles were wired, or hand-edited emails) — find it and heal below.
      if (!profileId) {
        profileId = await findAuthUserIdByEmail(email);
      }
      // Last resort: the email system is down — create the login without
      // sending anything. The member gets in via a manual link or a later
      // password reset; the grant itself must not fail.
      if (!profileId) {
        const manual = await createAccountWithoutEmail(email, input.name);
        if (manual.profileId) {
          profileId = manual.profileId;
          manualLoginLink = manual.loginLink;
        } else if (manual.error) {
          inviteFailure = `${inviteFailure ?? "invite failed"}; account creation also failed: ${manual.error}`;
        }
      }
    }
  }
  if (!profileId) {
    return {
      ...base,
      ok: false,
      message: inviteFailure
        ? `Couldn't invite ${email}: ${inviteFailure}`
        : "Could not invite or find this email.",
    };
  }

  // Signup trigger races the invite; upsert keeps the name.
  await admin.from("profiles").upsert(
    {
      id: profileId,
      email,
      ...(input.name?.trim() ? { full_name: input.name.trim() } : {}),
    },
    { onConflict: "id" },
  );

  // Idempotency: an active membership of the same tier that hasn't expired
  // means a retried Zapier task / re-pasted CSV row shouldn't double-grant.
  const { data: existing } = await admin
    .from("memberships")
    .select("id, access_expires_at")
    .eq("profile_id", profileId)
    .eq("tier", input.tier)
    .eq("status", "active");
  const stillActive = (existing ?? []).some(
    (m) => !m.access_expires_at || new Date(m.access_expires_at) > new Date(),
  );
  if (stillActive) {
    return {
      ...base,
      ok: true,
      invited,
      alreadyActive: true,
      message: `${email}: already has an active ${input.tier} membership.`,
    };
  }

  const now = new Date();
  const months = input.months ?? 0;
  const { error: memberError } = await admin.from("memberships").insert({
    profile_id: profileId,
    tier: input.tier,
    status: "active",
    access_starts_at: now.toISOString(),
    access_expires_at:
      months > 0 ? addMonths(now, months).toISOString() : null,
    source: input.source,
  });
  if (memberError) {
    return { ...base, ok: false, invited, message: memberError.message };
  }

  if (manualLoginLink) {
    return {
      ...base,
      ok: true,
      invited,
      message: `${email}: ${input.tier} granted, but the invite email couldn't be sent — send them this one-time login link yourself: ${manualLoginLink}`,
    };
  }
  return {
    ...base,
    ok: true,
    invited,
    message: invited
      ? `${email}: invited + ${input.tier} granted.`
      : `${email}: ${input.tier} granted (existing account).`,
  };
}
