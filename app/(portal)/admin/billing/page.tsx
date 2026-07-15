import Link from "next/link";
import {
  BillingSetup,
  type BillingStatus,
} from "@/components/admin/BillingSetup";
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
        <BillingSetup status={status} />
      )}
    </div>
  );
}
