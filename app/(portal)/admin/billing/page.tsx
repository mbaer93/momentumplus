import Link from "next/link";
import {
  BillingSetup,
  type BillingStatus,
} from "@/components/admin/BillingSetup";
import { PricingManager, type PricingInitial } from "@/components/admin/PricingManager";
import { ArrowLeftIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/auth-helpers";
import { getStripeSettings } from "@/lib/stripe";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminBillingPage() {
  const access = await getAdminAccess();
  const isSuper = access?.role === "super";
  const settings = isSuper ? await getStripeSettings() : null;

  const status: BillingStatus = {
    connected: Boolean(settings?.secretKey),
    accountName: settings?.accountName ?? "",
    livemode: Boolean(settings?.livemode),
    productsCreated: Boolean(settings?.prices.basic && settings?.prices.pro),
    basicPrice: settings?.displayPrices?.basic ?? null,
    proPrice: settings?.displayPrices?.pro ?? null,
    webhookConfigured: Boolean(settings?.webhookSecret),
    webhookUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co"}/api/webhooks/stripe`,
  };

  const pricingFor = (plan: "basic" | "pro"): PricingInitial => ({
    monthly: settings?.displayPrices?.[plan] ?? null,
    terms: {
      "3": settings?.termDisplay?.[plan]?.["3"] ?? null,
      "6": settings?.termDisplay?.[plan]?.["6"] ?? null,
      "12": settings?.termDisplay?.[plan]?.["12"] ?? null,
    },
  });

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Billing — Stripe</h2>
          <p>Connect Stripe so members can buy and manage their own plans</p>
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: billing setup activates once Supabase is connected.
        </div>
      )}

      {!isSuper ? (
        <div className="admin-hint">
          Billing setup is reserved for the Super Admin. Ask them to enable
          your access if you need changes here.
        </div>
      ) : (
        <>
          <PricingManager
            connected={status.connected}
            livemode={status.livemode}
            basic={pricingFor("basic")}
            pro={pricingFor("pro")}
          />
          <div className="section-header" style={{ marginTop: 8 }}>
            <div>
              <h3 style={{ fontSize: 15 }}>Stripe connection</h3>
              <p>Connect the account and turn on payment sync — set once.</p>
            </div>
          </div>
          <BillingSetup status={status} />
        </>
      )}
    </div>
  );
}
