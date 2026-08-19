import { emailPattern } from "@/lib/db-utils";
import {
  giftDateLabel,
  giftExtendedExpiry,
  giftPlanFor,
  isFutureStart,
  isGiftTier,
  parseGiftStart,
  pauseResumesAtUnix,
  type BilledRow,
} from "@/lib/gifts";
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
  /** First-login landing (default /welcome); sponsor reps get the
      sponsor-onboarding form instead. */
  inviteRedirect?: string;
  /** Explicit access end (overrides months) — e.g. sponsor seats that
      expire October 1 regardless of when they were invited. */
  accessExpiresAt?: string | null;
  /** Quiet create: make the account WITHOUT sending a Momentum+ invite
      email. Used by the TSLS Companion bridge, where TSLS is the single
      inviter and members cross over via SSO — so nobody gets two emails. */
  quiet?: boolean;
  /** Mark this account as a TEST account: full tier access, hidden from
      every member-facing list (migration 0089). Set-only — see the upsert
      below. */
  tester?: boolean;
  /** Gift start (ISO). In the future → the account is created now but the
      gift itself waits in scheduled_gifts until the gift-activate cron
      applies it on that date (TSLS sends the first of the event month —
      "free months don't start until the month of the event"). Past/absent
      → the gift applies immediately. Gift tiers only. */
  startAt?: string | null;
}

export interface ProvisionResult {
  ok: boolean;
  email: string;
  /** A brand-new account was created and an invite email sent. */
  invited: boolean;
  /** An equivalent active membership already existed; nothing inserted. */
  alreadyActive: boolean;
  message?: string;
  /**
   * One-time login link, ONLY when the invite email couldn't be sent. It is
   * a live account-takeover token, so it is a separate field (never baked
   * into `message`) and callers exposed to third parties (the Zapier webhook)
   * MUST NOT forward it — only the authenticated admin UI may surface it.
   */
  loginLink?: string | null;
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
    /*
     * TSLS ticket → free Momentum+ membership (Matt, 2026-08-19):
     * "General Admission gets one month free access to Momentum+ as a
     * Momentum+ Member. VIP gets 3 months."
     *
     * Both said 12 until now, which came in with PR #171 and contradicted
     * SPEC.md's own tier table. Nothing caught it because a grant that is
     * eleven months too long looks exactly like a correct one on every
     * screen — the member is simply a member. On ~350 October registrants
     * that is eleven extra months each of a $198/month product, given away
     * silently. tests/tsls-grants.test.ts now pins both numbers.
     */
    case "attendee":
    case "tslsattendee":
      return { tier: "tsls_attendee", months: 1 };
    case "tslsvip":
      return { tier: "tsls_vip", months: 3 };
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
    case "sponsor":
    case "sponsoruser":
      return { tier: "sponsor", months: 0 };
    default:
      return null;
  }
}

/**
 * Find an existing login by email even when its profiles row is missing or
 * carries a different email (accounts created before profiles were wired,
 * or edited by hand). One indexed query via the auth_user_id_by_email RPC
 * (migration 0069) — paging the whole Auth admin list cost up to 25 API
 * calls per lookup and stopped working past 5,000 accounts, which a
 * 2,500-attendee TSLS season approaches. The paging survives only as the
 * pre-migration fallback.
 */
export async function findAuthUserIdByEmail(
  email: string,
): Promise<string | null> {
  const admin = createServiceClient();
  const target = email.trim().toLowerCase();

  try {
    const { data, error } = await admin.rpc("auth_user_id_by_email", {
      p_email: target,
    });
    if (!error) return (data as string | null) ?? null;
  } catch {
    // fall through to the pre-0069 paging
  }

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

  const siteUrl = await requestSiteUrl();
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=/welcome`
        : undefined,
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

/**
 * A one-time sign-in link that lands on /welcome to set a password.
 *
 * For accounts provisioned quietly — a TSLS guest whose account was created
 * when they bought their ticket and who has never been emailed — this is the
 * only way in: they have no password to be asked for.
 *
 * `token_hash` rather than the raw action_link, deliberately. That shape is
 * device-independent and survives a corporate mail scanner following the URL
 * (see app/auth/confirm/route.ts); the PKCE `?code=` shape does not, which is
 * how Rob's links kept failing in August.
 */
export async function mintWelcomeLink(email: string): Promise<string | null> {
  const admin = createServiceClient();
  const siteUrl = await requestSiteUrl();
  const { data } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: siteUrl ? `${siteUrl}/auth/callback?redirect=/welcome` : undefined,
    },
  });
  const hashed = data?.properties?.hashed_token;
  return hashed
    ? `${siteUrl ?? ""}/auth/confirm?token_hash=${hashed}&type=recovery&redirect=/welcome`
    : (data?.properties?.action_link ?? null);
}

/** Park a gift until its start date (the month of the event). */
async function scheduleGift(input: {
  profileId: string;
  email: string;
  name: string;
  tier: Tier;
  months: number;
  startsAt: string;
  source: string;
}): Promise<Pick<ProvisionResult, "ok" | "alreadyActive" | "message">> {
  const admin = createServiceClient();

  // A retried bridge call must not stack a second pending gift — but a
  // DIFFERENT pending gift (a General → VIP ticket upgrade, or a stale one
  // from a moved event date) upgrades in place rather than blocking. The
  // dedup is scoped to match the unique index: (profile_id, starts_at).
  const { data: pending } = await admin
    .from("scheduled_gifts")
    .select("id, starts_at, tier, months")
    .eq("profile_id", input.profileId)
    .is("applied_at", null)
    .limit(1);
  if (pending?.length) {
    const row = pending[0];
    const sameStart =
      new Date(String(row.starts_at)).getTime() ===
      new Date(input.startsAt).getTime();
    if (sameStart && row.tier === input.tier && row.months === input.months) {
      return {
        ok: true,
        alreadyActive: true,
        message: `${input.email}: gift already scheduled for ${String(row.starts_at).slice(0, 10)}.`,
      };
    }
    const { error: upErr } = await admin
      .from("scheduled_gifts")
      .update({
        tier: input.tier,
        months: input.months,
        starts_at: input.startsAt,
      })
      .eq("id", row.id)
      .is("applied_at", null);
    if (upErr) {
      return { ok: false, alreadyActive: false, message: upErr.message };
    }
    return {
      ok: true,
      alreadyActive: false,
      message: `${input.email}: pending gift updated — ${input.months} month${input.months === 1 ? "" : "s"} from ${input.startsAt.slice(0, 10)}.`,
    };
  }

  const { error } = await admin.from("scheduled_gifts").insert({
    profile_id: input.profileId,
    email: input.email,
    name: input.name || null,
    tier: input.tier,
    months: input.months,
    starts_at: input.startsAt,
    source: input.source,
  });
  if (error) {
    if (/relation .*scheduled_gifts.* does not exist/i.test(error.message)) {
      return {
        ok: false,
        alreadyActive: false,
        message: "Run migration 0068 in Supabase first.",
      };
    }
    // Unique-index race with a parallel call: someone else scheduled it.
    if (error.code === "23505") {
      return {
        ok: true,
        alreadyActive: true,
        message: `${input.email}: gift already scheduled.`,
      };
    }
    return { ok: false, alreadyActive: false, message: error.message };
  }
  return {
    ok: true,
    alreadyActive: false,
    message: `${input.email}: account ready — ${input.months} gift month${input.months === 1 ? "" : "s"} start ${input.startsAt.slice(0, 10)} (the month of the event).`,
  };
}

export interface ScheduledGiftRow {
  id: string;
  profile_id: string;
  email: string;
  name: string | null;
  tier: Tier;
  months: number;
  starts_at: string;
  source: string | null;
}

/**
 * Apply a scheduled gift whose start date has arrived (gift-activate cron).
 * Same behavior as an immediate gift: paying members get the billing
 * pause / end-of-membership extension (with the email), everyone else gets
 * the membership row — its clock anchored on the scheduled start, not on
 * when the cron happened to run.
 */
export async function activateScheduledGift(
  row: ScheduledGiftRow,
): Promise<{ ok: boolean; result: string }> {
  const gifted = await applyGiftToPayingMember({
    profileId: row.profile_id,
    email: row.email,
    name: row.name ?? "",
    months: row.months,
    // Anchor on the scheduled start: a late activation (retry, backlog)
    // must not silently run the gift long.
    anchor: new Date(row.starts_at).getTime(),
  });
  if (gifted) {
    return { ok: gifted.ok, result: gifted.message ?? "applied to paying member" };
  }

  const admin = createServiceClient();
  const { data: existing } = await admin
    .from("memberships")
    .select("id, access_expires_at")
    .eq("profile_id", row.profile_id)
    .eq("tier", row.tier)
    .eq("status", "active");
  const stillActive = (existing ?? []).some(
    (m) => !m.access_expires_at || new Date(m.access_expires_at) > new Date(),
  );
  if (stillActive) {
    return { ok: true, result: "already has an active membership of this tier" };
  }

  const starts = new Date(row.starts_at);
  const { error } = await admin.from("memberships").insert({
    profile_id: row.profile_id,
    tier: row.tier,
    status: "active",
    access_starts_at: starts.toISOString(),
    access_expires_at: addMonths(starts, row.months).toISOString(),
    source: row.source ?? "zapier",
  });
  if (error) return { ok: false, result: error.message };
  return {
    ok: true,
    result: `granted ${row.months} month${row.months === 1 ? "" : "s"} from ${row.starts_at.slice(0, 10)}`,
  };
}

/**
 * A TSLS gift arriving on someone who already PAYS for Momentum+ (Matt,
 * 2026-07-29): Stripe-billed members get their collection paused for the
 * gift length (Stripe resumes it by itself at resumes_at) and their paid
 * access pushed out the same amount; members billed elsewhere get the
 * months added to the end of their membership. Either way the member gets
 * an email saying exactly what happened, and the audit log keeps a
 * once-per-season ledger so a bridge retry can't pause or extend twice.
 *
 * Returns null when the member isn't a paying member — the caller then
 * inserts the normal gift membership row.
 */
async function applyGiftToPayingMember(input: {
  profileId: string;
  email: string;
  name: string;
  months: number;
  /** Gift clock anchor — the scheduled start for parked gifts, so a
      late-running activation doesn't silently run long. Defaults to now. */
  anchor?: number;
}): Promise<Pick<
  ProvisionResult,
  "ok" | "invited" | "alreadyActive" | "message"
> | null> {
  const anchor = input.anchor ?? Date.now();
  const admin = createServiceClient();
  const { data: rows } = await admin
    .from("memberships")
    .select("id, tier, status, access_expires_at, source, stripe_subscription_id")
    .eq("profile_id", input.profileId);
  const plan = giftPlanFor((rows ?? []) as BilledRow[]);
  if (plan.kind === "grant") return null;

  // Once-per-season ledger: ~10 months comfortably covers a season without
  // blocking next year's gift.
  const since = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString();
  const { data: prior } = await admin
    .from("admin_audit_log")
    .select("id")
    .eq("target_profile_id", input.profileId)
    .in("action", ["tsls_gift_paused", "tsls_gift_extended"])
    .gte("at", since)
    .limit(1);
  if (prior?.length) {
    return {
      ok: true,
      invited: false,
      alreadyActive: true,
      message: `${input.email}: TSLS gift already applied this season.`,
    };
  }

  const months = input.months;
  const monthsLabel = `${months} month${months === 1 ? "" : "s"}`;
  const newExpiry = giftExtendedExpiry(plan.row.access_expires_at, months, anchor);

  let paused = false;
  let pauseNote = "";
  if (plan.kind === "pause") {
    const { getStripeSettings, stripeRequest } = await import("@/lib/stripe");
    const settings = await getStripeSettings();
    if (settings?.secretKey && plan.row.stripe_subscription_id) {
      try {
        const sub = await stripeRequest<{
          pause_collection?: unknown;
          items?: {
            data?: {
              price?: { recurring?: { interval?: string; interval_count?: number } };
            }[];
          };
        }>(
          settings.secretKey,
          "GET",
          `/subscriptions/${plan.row.stripe_subscription_id}`,
        );
        if (sub.pause_collection) {
          /*
           * Billing already paused. A COMPLETED gift is caught by the
           * season guard (the audit-ledger query above), so reaching here
           * with an existing pause almost always means a prior run paused
           * Stripe and then crashed before the ledger + expiry extension
           * (audit P2-21: that retry used to be answered "gift already
           * applied", leaving the member paused but never extended).
           * Don't re-pause; DO fall through to the ledger + extension the
           * crashed run never reached.
           */
          paused = true;
        } else {
          /*
           * behavior=void voids every invoice raised inside the pause
           * window. For a monthly plan that's exactly "skip the gift
           * months" — but a 3/6/12-month term whose renewal lands inside
           * the window would have its WHOLE term invoice voided (12 free
           * months for a 3-month gift). Only pause when the billing
           * interval fits inside the gift; longer terms get the access
           * extension below instead.
           */
          const recurring = sub.items?.data?.[0]?.price?.recurring;
          const intervalMonths =
            recurring?.interval === "year"
              ? 12 * (recurring.interval_count ?? 1)
              : recurring?.interval === "month"
                ? (recurring.interval_count ?? 1)
                : null;
          if (intervalMonths !== null && intervalMonths <= months) {
            await stripeRequest(
              settings.secretKey,
              "POST",
              `/subscriptions/${plan.row.stripe_subscription_id}`,
              {
                "pause_collection[behavior]": "void",
                "pause_collection[resumes_at]": pauseResumesAtUnix(months, anchor),
              },
            );
            paused = true;
          } else {
            pauseNote = "";
          }
        }
      } catch (e) {
        pauseNote = ` (Stripe pause failed: ${(e as Error).message} — pause the subscription by hand in Stripe)`;
      }
    } else {
      pauseNote = " (Stripe isn't connected — pause the subscription by hand)";
    }
  }

  /*
   * LEDGER BEFORE MUTATION: the audit row doubles as the once-per-season
   * guard, so it must exist before the expiry is extended — a crash between
   * the extension and a late ledger write would re-extend on every retry.
   * (The action label is corrected below if the pause outcome differs.)
   */
  const { logAdminActionStrict } = await import("@/lib/admin-audit");
  const ledgered = await logAdminActionStrict({
    actorId: null,
    actorEmail: "system (tsls gift)",
    action: paused ? "tsls_gift_paused" : "tsls_gift_extended",
    targetProfileId: input.profileId,
    targetEmail: input.email,
    detail: `${monthsLabel} TSLS gift on a paying member (${plan.row.tier}); access through ${newExpiry.slice(0, 10)}${paused ? "; Stripe billing paused" : ""}${pauseNote}`,
  });
  if (!ledgered) {
    // The audit row IS the once-per-season guard. If it didn't persist, do
    // NOT extend — the caller (TSLS bridge / Zapier) retries the whole gift,
    // and a completed extension without a ledger row would re-extend on
    // every retry, so access would outlive what was paid. Bail cleanly.
    return {
      ok: false,
      invited: false,
      alreadyActive: false,
      message: "gift ledger write failed — not applied, will retry",
    };
  }

  await admin
    .from("memberships")
    .update({ access_expires_at: newExpiry })
    .eq("id", plan.row.id);

  // Tell the member — a silent billing change is how trust dies.
  let emailNote = "";
  try {
    const [{ sendEmailViaGhl }, { brandedEmailHtml }] = await Promise.all([
      import("@/lib/notifications"),
      import("@/lib/email-template"),
    ]);
    const expiryLabel = giftDateLabel(newExpiry);
    const bodyHtml = paused
      ? `<p style="margin:0 0 14px;">Thank you for being at the Tri-State Leadership Summit! Your attendee gift — <strong>${monthsLabel} of Momentum+ on us</strong> — is now active.</p>
         <p style="margin:0 0 14px;">Since you're already a member, we've <strong>paused your billing for ${monthsLabel}</strong>. You keep full access the entire time, there's nothing you need to do, and billing resumes on its own afterward. Your paid access now runs through ${expiryLabel}.</p>`
      : `<p style="margin:0 0 14px;">Thank you for being at the Tri-State Leadership Summit! Your attendee gift — <strong>${monthsLabel} of Momentum+ on us</strong> — is now active.</p>
         <p style="margin:0 0 14px;">Since you're already a member, we've <strong>added the ${monthsLabel} to the end of your membership</strong> — your access now runs through ${expiryLabel}.</p>`;
    const res = await sendEmailViaGhl({
      email: input.email,
      subject: "[Momentum+] Your TSLS gift is live",
      html: brandedEmailHtml({
        greetingName: input.name.split(" ")[0] || "",
        heading: "Your TSLS gift is live",
        bodyHtml,
        ctaLabel: "Open Momentum+",
        ctaUrl: "/dashboard",
        footnote:
          "You're getting this because you attended the Tri-State Leadership Summit as a Momentum+ member.",
      }),
    });
    if (!res.sent) emailNote = ` (email not sent: ${res.reason ?? "unknown"})`;
  } catch (e) {
    emailNote = ` (email not sent: ${(e as Error).message})`;
  }

  return {
    ok: true,
    invited: false,
    alreadyActive: false,
    message: paused
      ? `${input.email}: paying member — Stripe billing paused ${monthsLabel}, access extended to ${newExpiry.slice(0, 10)}.${emailNote}`
      : `${input.email}: paying member — ${monthsLabel} added to their membership (now ${newExpiry.slice(0, 10)}).${pauseNote}${emailNote}`,
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
    .ilike("email", emailPattern(email))
    .maybeSingle();
  if (profile) {
    profileId = profile.id;
  } else if (input.quiet) {
    // No email: create the login directly (TSLS is the sole inviter). If the
    // account already exists as an auth user without a matching profile row,
    // fall back to finding it. `invited` stays false — we sent nothing.
    const manual = await createAccountWithoutEmail(email, input.name);
    profileId = manual.profileId ?? (await findAuthUserIdByEmail(email));
    if (!profileId && manual.error) inviteFailure = manual.error;
  } else {
    const siteUrl = await requestSiteUrl();
    const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.name ?? "" },
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=${encodeURIComponent(input.inviteRedirect ?? "/welcome")}`
        : undefined,
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
        .ilike("email", emailPattern(email))
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
  const profileRow: Record<string, unknown> = {
    id: profileId,
    email,
    ...(input.name?.trim() ? { full_name: input.name.trim() } : {}),
  };
  /*
   * Only ever SET the flag, never clear it. An un-flagged provisioning run
   * for someone already marked (a re-sync, a second grant) must not quietly
   * turn a test account into a visible member — unmarking is a deliberate
   * admin action, not a side effect of a webhook.
   */
  if (input.tester) {
    profileRow.tester = true;
    profileRow.tester_since = new Date().toISOString();
  }
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });
  // Pre-migration-0089: retry without the tester columns rather than lose
  // the name and email this upsert also carries.
  if (profileError && /tester/i.test(profileError.message)) {
    delete profileRow.tester;
    delete profileRow.tester_since;
    await admin.from("profiles").upsert(profileRow, { onConflict: "id" });
  }

  // Gift with a future start (ticket bought before the event): the account
  // now exists, but the free months must not start until the month of the
  // event (Matt, 2026-07-30) — park the gift in scheduled_gifts for the
  // gift-activate cron and stop here.
  /*
   * A TESTER's gift starts NOW, whatever start date came with it.
   *
   * TSLS sends startAt = the first of the event month for every attendee
   * gift, so a tester provisioned in August would get an account with no
   * active membership until October 1 — i.e. the paywall, which is the one
   * thing they cannot test through. Ignoring the date here rather than
   * asking the sender to special-case it keeps the rule in one place: any
   * caller that flags someone a tester gets a usable account, and there is
   * no second thing to remember (Matt, 2026-08-14).
   */
  const startAt = input.tester ? null : parseGiftStart(input.startAt);
  if (isGiftTier(input.tier) && (input.months ?? 0) > 0 && isFutureStart(startAt)) {
    const scheduled = await scheduleGift({
      profileId,
      email,
      name: input.name ?? "",
      tier: input.tier,
      months: input.months ?? 1,
      startsAt: startAt as string,
      source: input.source,
    });
    return { ...base, invited, ...scheduled };
  }

  // TSLS gift landing on a PAYING member: don't bury a free row under their
  // subscription — pause their Stripe billing (or add the months to the end
  // of a non-Stripe membership) and tell them. See lib/gifts.ts.
  if (isGiftTier(input.tier) && (input.months ?? 0) > 0) {
    const gifted = await applyGiftToPayingMember({
      profileId,
      email,
      name: input.name ?? "",
      months: input.months ?? 1,
    });
    if (gifted) return { ...base, ...gifted };
  }

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
      input.accessExpiresAt !== undefined
        ? input.accessExpiresAt
        : months > 0
          ? addMonths(now, months).toISOString()
          : null,
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
      // Link is returned in loginLink (admin-only surfaces), NOT in message —
      // message may travel into third-party logs (Zapier task history).
      loginLink: manualLoginLink,
      message: `${email}: ${input.tier} granted, but the invite email couldn't be sent — issue a one-time login link from Admin → Members.`,
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
