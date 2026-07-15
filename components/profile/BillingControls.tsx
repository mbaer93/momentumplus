"use client";

import { useState, useTransition } from "react";
import {
  openBillingPortal,
  startCheckout,
} from "@/app/(portal)/profile/billing-actions";

/*
 * Self-serve plan controls (rendered once Stripe is connected via the
 * Admin → Billing wizard): subscribe/upgrade via Checkout, and manage
 * card/plan/cancellation via the Stripe customer portal.
 */

export interface BillingInfo {
  enabled: boolean;
  basicPrice: number | null;
  proPrice: number | null;
  hasCustomer: boolean;
  /** Viewer already holds pro/admin-level access. */
  isPro: boolean;
  /** Viewer holds any active paid/comp membership. */
  hasActiveMembership: boolean;
}

export function BillingControls({ billing }: { billing: BillingInfo }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (!billing.enabled) return null;

  function go(fn: () => Promise<{ ok: boolean; url?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok && res.url) {
          window.location.href = res.url;
        } else {
          setMsg(res.message ?? "Something went wrong — try again.");
        }
      } catch {
        setMsg("Something went wrong — try again.");
      }
    });
  }

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {!billing.isPro && (
        <button
          type="button"
          className="btn-sm-gold"
          disabled={pending}
          onClick={() => go(() => startCheckout("pro"))}
        >
          Upgrade to Pro{billing.proPrice ? ` — $${billing.proPrice}/mo` : ""}
        </button>
      )}
      {!billing.hasActiveMembership && (
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() => go(() => startCheckout("basic"))}
        >
          Subscribe to Basic{billing.basicPrice ? ` — $${billing.basicPrice}/mo` : ""}
        </button>
      )}
      {billing.hasCustomer && (
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          onClick={() => go(() => openBillingPortal())}
        >
          Manage billing (card, plan, cancel)
        </button>
      )}
      {msg && (
        <div className="admin-form-msg err" style={{ marginTop: 2 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
