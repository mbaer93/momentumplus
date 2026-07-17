"use client";

import { useState, useTransition } from "react";
import {
  openBillingPortal,
  startCheckout,
} from "@/app/(portal)/profile/billing-actions";

/** Stripe self-serve renewal buttons on the lapsed-membership page. */
export function RenewButtons({
  basicPrice,
  proPrice,
}: {
  basicPrice: number | null;
  proPrice: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go(plan: "basic" | "pro") {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await startCheckout(plan);
        if (res.ok && res.url) window.location.href = res.url;
        else setMsg(res.message ?? "Something went wrong — try again.");
      } catch {
        setMsg("Something went wrong — try again.");
      }
    });
  }

  // Failed card is the most common lapse: the fix lives in the Stripe
  // billing portal (update card, retry payment), not a new checkout.
  function fixCard() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await openBillingPortal();
        if (res.ok && res.url) window.location.href = res.url;
        else setMsg(res.message ?? "Something went wrong — try again.");
      } catch {
        setMsg("Something went wrong — try again.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() => go("basic")}
        >
          Renew Basic{basicPrice ? ` — $${basicPrice}/mo` : ""}
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={pending}
          onClick={() => go("pro")}
        >
          Go Pro{proPrice ? ` — $${proPrice}/mo` : ""}
        </button>
      </div>
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        onClick={fixCard}
        style={{ fontSize: 13 }}
      >
        Card declined? Update your payment method
      </button>
      {msg && (
        <div className="admin-form-msg err" style={{ textAlign: "center" }}>
          {msg}
        </div>
      )}
    </div>
  );
}
