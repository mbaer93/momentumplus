import { NextResponse, type NextRequest } from "next/server";
import {
  getStripeSettings,
  stripeRequest,
  verifyStripeSignature,
} from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Stripe → membership sync. Registered by the Admin → Billing wizard.
 *   checkout.session.completed  → create the membership (tier from metadata)
 *   customer.subscription.updated → extend/adjust access to the paid period
 *   customer.subscription.deleted → mark canceled (access until period end)
 *   invoice.payment_failed        → past_due (7-day grace semantics apply)
 * Signature-verified with the stored signing secret; events we don't know
 * are acknowledged and ignored.
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
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") {
    return "canceled";
  }
  return "active";
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
      case "checkout.session.completed": {
        const s = event.data.object as {
          metadata?: Record<string, string>;
          subscription?: string;
          customer?: string;
          customer_details?: { email?: string };
        };
        let profileId = s.metadata?.profile_id;
        const plan = s.metadata?.plan === "pro" ? "pro" : "basic";
        const subId = s.subscription;
        if (!subId) break;

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
            .ilike("email", email)
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
              profileId =
                (await findAuthUserIdByEmail(email)) ??
                (await createAccountWithoutEmail(email, s.metadata?.signup_name))
                  .profileId ??
                undefined;
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
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as unknown as StripeSubscription;
        const status = mapStatus(sub.status);
        const patch: Record<string, unknown> = { status };
        // Only a paid period extends access — a declined renewal advances
        // Stripe's period but must not hand out a free month.
        const end = periodEndIso(sub);
        if (end && status === "active") patch.access_expires_at = end;
        // Portal plan switches change the price on the subscription; keep
        // the tier in lockstep so access always matches what they pay for.
        const priceId = (
          sub as unknown as { items?: { data?: { price?: { id?: string } }[] } }
        ).items?.data?.[0]?.price?.id;
        if (priceId && settings.prices.basic && settings.prices.pro) {
          if (priceId === settings.prices.pro) patch.tier = "pro";
          else if (priceId === settings.prices.basic) patch.tier = "basic";
        }

        const { data: row } = await admin
          .from("memberships")
          .update(patch)
          .eq("stripe_subscription_id", sub.id)
          .select("id")
          .maybeSingle();

        // Missed checkout event (e.g. webhook added later): create from
        // subscription metadata when we can.
        if (!row && sub.metadata?.profile_id) {
          await admin.from("memberships").insert({
            profile_id: sub.metadata.profile_id,
            tier: sub.metadata.plan === "pro" ? "pro" : "basic",
            status: mapStatus(sub.status),
            access_starts_at: new Date().toISOString(),
            access_expires_at: periodEndIso(sub),
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
        const inv = event.data.object as { subscription?: string };
        if (inv.subscription) {
          await admin
            .from("memberships")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", inv.subscription);
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
