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
import {
  invoiceSubscriptionId,
  mapStatus,
  periodEndIso,
} from "@/lib/stripe-events";

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
        const planMeta = s.metadata?.plan;
        const plan = planMeta === "pro" ? "pro" : "basic";
        const subId = s.subscription;
        if (!subId) break;
        // Shared Stripe account: Go High Level, Aspire2Achieve, and coaching
        // all invoice through this same webhook endpoint. Provision ONLY when
        // the session carries a Momentum+ fingerprint — our own checkouts
        // always set metadata.plan (public /join) and/or metadata.profile_id
        // (in-app upgrade). A foreign subscription checkout has neither, and
        // minting a Momentum+ account + active membership for, say, a
        // coaching client is exactly the bug this guards against.
        const isMomentumCheckout =
          Boolean(profileId) || planMeta === "basic" || planMeta === "pro";
        if (!isMomentumCheckout) break;
        // Delayed payment methods (ACH) complete as "unpaid" and are
        // provisioned later on async_payment_succeeded. Trials complete as
        // "no_payment_required" and must provision NOW — the subscription is
        // live, and the membership row is what billing's duplicate-
        // subscription guard keys off; skipping it would let a comped member
        // start a second, billable subscription.
        if (
          s.payment_status &&
          s.payment_status !== "paid" &&
          s.payment_status !== "no_payment_required"
        )
          break;

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
          // supabase-js reports failures via { error } instead of throwing,
          // so every DB step in this webhook throws explicitly — the outer
          // catch turns that into the 500 that makes Stripe retry.
          const { data: profile, error: profileLookupError } = await admin
            .from("profiles")
            .select("id")
            .ilike("email", emailPattern(email))
            .maybeSingle();
          if (profileLookupError) {
            throw new Error(`profile lookup failed: ${profileLookupError.message}`);
          }
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
        const { data: existing, error: existingError } = await admin
          .from("memberships")
          .select("id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (existingError) {
          throw new Error(`idempotency check failed: ${existingError.message}`);
        }
        if (existing) break;

        if (s.customer) {
          const { error: customerError } = await admin
            .from("profiles")
            .update({ stripe_customer_id: s.customer })
            .eq("id", profileId);
          if (customerError) {
            throw new Error(`customer id save failed: ${customerError.message}`);
          }
        }

        const sub = await stripeRequest<StripeSubscription>(
          settings.secretKey,
          "GET",
          `/subscriptions/${subId}`,
        );
        const { error: insertError } = await admin.from("memberships").insert({
          profile_id: profileId,
          tier: plan,
          status: "active",
          access_starts_at: new Date().toISOString(),
          access_expires_at: periodEndIso(sub),
          source: "stripe",
          stripe_subscription_id: subId,
        });
        if (insertError) {
          // The write that turns a payment into access — a paid checkout
          // must never be acknowledged with this row missing.
          throw new Error(`membership insert failed: ${insertError.message}`);
        }

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
        // Only ever EXTEND. A TSLS gift (lib/gifts.ts) pushes the expiry past
        // the current paid period; the first invoice after the pause must not
        // pull it back.
        if (end) {
          const { data: row, error: readError } = await admin
            .from("memberships")
            .select("access_expires_at")
            .eq("stripe_subscription_id", subId)
            .maybeSingle();
          // A failed read must not be treated as "no expiry" — that would
          // pull a gifted expiry back to the paid period.
          if (readError) {
            throw new Error(`expiry read failed: ${readError.message}`);
          }
          const current = row?.access_expires_at
            ? new Date(row.access_expires_at as string).getTime()
            : 0;
          if (new Date(end).getTime() > current) patch.access_expires_at = end;
        }
        const { error: paidError } = await admin
          .from("memberships")
          .update(patch)
          .eq("stripe_subscription_id", subId);
        if (paidError) {
          throw new Error(`invoice.paid update failed: ${paidError.message}`);
        }
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

        const { data: row, error: updateError } = await admin
          .from("memberships")
          .update(patch)
          .eq("stripe_subscription_id", sub.id)
          .select("id")
          .maybeSingle();
        if (updateError) {
          throw new Error(`subscription.updated failed: ${updateError.message}`);
        }

        // Missed checkout event (e.g. webhook added later): create from
        // subscription metadata when we can. Never insert a row with open
        // -ended access — a null expiry reads as indefinite downstream.
        if (!row && sub.metadata?.profile_id) {
          const { error: healError } = await admin.from("memberships").insert({
            profile_id: sub.metadata.profile_id,
            tier: sub.metadata.plan === "pro" ? "pro" : "basic",
            status: mapStatus(sub.status),
            access_starts_at: new Date().toISOString(),
            access_expires_at: periodEndIso(sub) ?? new Date().toISOString(),
            source: "stripe",
            stripe_subscription_id: sub.id,
          });
          if (healError) {
            throw new Error(`missed-checkout heal failed: ${healError.message}`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as StripeSubscription;
        // Canceled keeps access until the already-paid period end (grace
        // semantics in membership_grants_access).
        const { error: cancelError } = await admin
          .from("memberships")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        if (cancelError) {
          throw new Error(`cancel update failed: ${cancelError.message}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const subId = invoiceSubscriptionId(
          event.data.object as Parameters<typeof invoiceSubscriptionId>[0],
        );
        if (!subId) break;
        // past_due with a guaranteed grace window: the member keeps the
        // LATER of their already-paid period and a 7-day grace, matching the
        // GHL path (Math.max) and the 7-day promise the dunning emails make.
        // A renewal failure (paid period ≈ now) therefore still gets the
        // full 7 days instead of near-zero; an off-cycle failure keeps the
        // paid time they've already got.
        const { data: row, error: failReadError } = await admin
          .from("memberships")
          .select("id, access_expires_at")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (failReadError) {
          throw new Error(`payment_failed read failed: ${failReadError.message}`);
        }
        if (row) {
          const grace = new Date(
            Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString();
          const current = row.access_expires_at as string | null;
          const { error: pastDueError } = await admin
            .from("memberships")
            .update({
              status: "past_due",
              access_expires_at: current && current > grace ? current : grace,
            })
            .eq("id", row.id);
          if (pastDueError) {
            throw new Error(`past_due update failed: ${pastDueError.message}`);
          }
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
