import { emailPattern } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import {
  getStripeSettings,
  stripeRequest,
  verifyStripeSignature,
} from "@/lib/stripe";
import { GRACE_DAYS } from "@/lib/membership";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Stripe → membership sync. Registered by the Admin → Billing wizard.
 *   checkout.session.completed        → create the membership (paid checkouts
 *                                       only; ACH etc. wait for async success)
 *   checkout.session.async_payment_succeeded → same, for delayed methods
 *   invoice.paid                      → extend access to the newly PAID period
 *   customer.subscription.updated     → status/tier changes (never extends)
 *   customer.subscription.deleted     → mark canceled (access until period end)
 *   invoice.payment_failed            → past_due + clamp access to 7-day grace
 * Signature-verified with the stored signing secret; events we don't know
 * are acknowledged and ignored.
 *
 * Access extension deliberately lives on invoice.paid, not
 * subscription.updated: at renewal Stripe advances current_period_end while
 * the invoice is still unpaid and status is still "active", so extending on
 * "updated" hands a failed card a free billing term.
 */

interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
  metadata?: Record<string, string>;
  customer?: string;
}

function periodEndIso(sub: StripeSubscription): string | null {
  const unix =
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

function mapStatus(stripeStatus: string): "active" | "past_due" | "canceled" {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") {
    return "canceled";
  }
  // past_due, unpaid, incomplete, paused, anything new Stripe invents:
  // access only until the already-paid period (or grace) runs out.
  return "past_due";
}

/**
 * Invoice → subscription id. Current ("Basil", 2025+) Stripe API versions
 * moved it under parent.subscription_details; older versions have it
 * top-level. Accept both — the webhook endpoint doesn't pin api_version.
 */
function invoiceSubscriptionId(inv: {
  subscription?: string | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
}): string | null {
  const sub = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  return typeof sub === "string" && sub ? sub : null;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const settings = await getStripeSettings();
  if (!settings?.webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const valid = verifyStripeSignature(
    payload,
    req.headers.get("stripe-signature"),
    settings.webhookSecret,
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };
  const admin = createServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as {
          metadata?: Record<string, string>;
          subscription?: string;
          customer?: string;
          customer_details?: { email?: string };
          payment_status?: string;
        };
        let profileId = s.metadata?.profile_id;
        const plan = s.metadata?.plan === "pro" ? "pro" : "basic";
        const subId = s.subscription;
        if (!subId) break;
        // Delayed payment methods (ACH) complete checkout with
        // payment_status "unpaid"; the membership is created when the
        // async_payment_succeeded event confirms the money actually moved.
        if (s.payment_status && s.payment_status !== "paid") break;

        // Public signup (momentumplus.co home page): no account yet — find
        // or invite one by the checkout email. The invite email lands them
        // on /welcome to set a password.
        if (!profileId) {
          const email = (
            s.metadata?.signup_email ??
            s.customer_details?.email ??
            ""
          )
            .trim()
            .toLowerCase();
          if (!email) break;
          const { data: profile } = await admin
            .from("profiles")
            .select("id")
            .ilike("email", emailPattern(email))
            .maybeSingle();
          if (profile) {
            profileId = profile.id;
          } else {
            const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
            const { data: invited } =
              await admin.auth.admin.inviteUserByEmail(email, {
                data: s.metadata?.signup_name
                  ? { full_name: s.metadata.signup_name }
                  : undefined,
                redirectTo: siteUrl
                  ? `${siteUrl}/auth/callback?redirect=/welcome`
                  : undefined,
              });
            profileId = invited?.user?.id;
            if (!profileId) {
              // Same healing ladder as admin grants: existing login without
              // a profile row, then account-without-email. A paying customer
              // must never end up with no account.
              const { findAuthUserIdByEmail, createAccountWithoutEmail } =
                await import("@/lib/onboarding");
              const existingId = await findAuthUserIdByEmail(email);
              if (existingId) {
                profileId = existingId;
              } else {
                const created = await createAccountWithoutEmail(
                  email,
                  s.metadata?.signup_name,
                );
                profileId = created.profileId ?? undefined;
                // The invite email failed, so the member is waiting on an
                // email that will never come. Leave a visible trail for the
                // team (Audit Log) — the member can also self-serve via the
                // magic-link / reset flow, which the /join success copy
                // points at.
                if (profileId) {
                  const { logAdminAction } = await import("@/lib/admin-audit");
                  await logAdminAction({
                    actorId: null,
                    actorEmail: "system (stripe webhook)",
                    action: "invite_email_failed",
                    targetProfileId: profileId,
                    targetEmail: email,
                    detail:
                      "Paid signup provisioned without an invite email — member should use the sign-in link on /login, or re-send the invite from Admin → Members.",
                  });
                }
              }
            }
          }
        }
        if (!profileId) {
          // 500 → Stripe retries; a paid checkout must not be silently lost.
          return NextResponse.json(
            { error: "could not provision account for paid checkout" },
            { status: 500 },
          );
        }

        // Idempotency: Stripe retries deliveries.
        const { data: existing } = await admin
          .from("memberships")
          .select("id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (existing) break;

        if (s.customer) {
          await admin
            .from("profiles")
            .update({ stripe_customer_id: s.customer })
            .eq("id", profileId);
        }

        const sub = await stripeRequest<StripeSubscription>(
          settings.secretKey,
          "GET",
          `/subscriptions/${subId}`,
        );
        await admin.from("memberships").insert({
          profile_id: profileId,
          tier: plan,
          status: "active",
          access_starts_at: new Date().toISOString(),
          access_expires_at: periodEndIso(sub),
          source: "stripe",
          stripe_subscription_id: subId,
        });

        // Referral attribution: the /join?ref= code rode along in checkout
        // metadata. Rewards the referrer; never blocks provisioning.
        if (s.metadata?.referral_code) {
          const { attributeReferral } = await import("@/lib/referrals");
          await attributeReferral({
            referredProfileId: profileId,
            code: s.metadata.referral_code,
          });
        }
        break;
      }

      case "invoice.paid": {
        // The only event that extends access: money actually settled for
        // the new period. Pull the fresh period end off the subscription.
        const subId = invoiceSubscriptionId(
          event.data.object as Parameters<typeof invoiceSubscriptionId>[0],
        );
        if (!subId) break;
        const sub = await stripeRequest<StripeSubscription>(
          settings.secretKey,
          "GET",
          `/subscriptions/${subId}`,
        );
        const end = periodEndIso(sub);
        const patch: Record<string, unknown> = { status: mapStatus(sub.status) };
        if (end) patch.access_expires_at = end;
        await admin
          .from("memberships")
          .update(patch)
          .eq("stripe_subscription_id", subId);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as unknown as StripeSubscription;
        const status = mapStatus(sub.status);
        const patch: Record<string, unknown> = { status };
        // No access extension here — at renewal Stripe advances the period
        // before the invoice is paid, so extension waits for invoice.paid.
        // Portal plan switches change the price on the subscription; keep
        // the tier in lockstep so access always matches what they pay for.
        const priceId = (
          sub as unknown as { items?: { data?: { price?: { id?: string } }[] } }
        ).items?.data?.[0]?.price?.id;
        if (priceId) {
          const { planForPrice } = await import("@/lib/stripe");
          const plan = planForPrice(settings, priceId);
          if (plan) patch.tier = plan;
        }

        const { data: row } = await admin
          .from("memberships")
          .update(patch)
          .eq("stripe_subscription_id", sub.id)
          .select("id")
          .maybeSingle();

        // Missed checkout event (e.g. webhook added later): create from
        // subscription metadata when we can. Never insert a row with open
        // -ended access — a null expiry reads as indefinite downstream.
        if (!row && sub.metadata?.profile_id) {
          await admin.from("memberships").insert({
            profile_id: sub.metadata.profile_id,
            tier: sub.metadata.plan === "pro" ? "pro" : "basic",
            status: mapStatus(sub.status),
            access_starts_at: new Date().toISOString(),
            access_expires_at: periodEndIso(sub) ?? new Date().toISOString(),
            source: "stripe",
            stripe_subscription_id: sub.id,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as StripeSubscription;
        // Canceled keeps access until the already-paid period end (grace
        // semantics in membership_grants_access).
        await admin
          .from("memberships")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      case "invoice.payment_failed": {
        const subId = invoiceSubscriptionId(
          event.data.object as Parameters<typeof invoiceSubscriptionId>[0],
        );
        if (!subId) break;
        // past_due + clamp: if an earlier subscription.updated already
        // stretched access into the unpaid period, pull it back to a 7-day
        // grace window (same GRACE_DAYS semantics as GHL members). Never
        // extends an expiry that is already sooner.
        const { data: row } = await admin
          .from("memberships")
          .select("id, access_expires_at")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (row) {
          const grace = new Date(
            Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString();
          const current = row.access_expires_at as string | null;
          await admin
            .from("memberships")
            .update({
              status: "past_due",
              access_expires_at: current && current < grace ? current : grace,
            })
            .eq("id", row.id);
        }
        break;
      }

      default:
        break; // acknowledged, ignored
    }
  } catch (e) {
    // 500 → Stripe retries later.
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
