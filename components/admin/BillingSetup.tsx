"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectStripe,
  saveWebhookSecret,
  setupStripeWebhook,
} from "@/app/(portal)/admin/billing/actions";

/*
 * Stripe connection setup for the Super Admin: connect the account and turn
 * on the payment-sync webhook. Prices themselves live in the PricingManager
 * grid above — this is just the plumbing.
 */

export interface BillingStatus {
  connected: boolean;
  accountName: string;
  livemode: boolean;
  productsCreated: boolean;
  basicPrice: number | null;
  proPrice: number | null;
  webhookConfigured: boolean;
  webhookUrl: string;
}

function StepBadge({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
        background: done ? "var(--accent-green)" : "var(--navy)",
        color: "#fff",
      }}
    >
      {done ? "✓" : n}
    </span>
  );
}

export function BillingSetup({ status }: { status: BillingStatus }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't go through — try again.", ok: false });
      }
    });
  }

  // Two-step connection flow now (pricing moved to the grid above).
  const step = !status.connected ? 1 : !status.webhookConfigured ? 2 : 3;

  return (
    <div style={{ maxWidth: 760 }}>
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginBottom: 14 }}
        >
          {msg.text}
        </div>
      )}

      {/* Step 1 */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <StepBadge done={status.connected} n={1} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Connect your Stripe account
            </div>
            {status.connected ? (
              <div style={{ fontSize: 13, color: "var(--accent-green)" }}>
                Connected to <strong>{status.accountName}</strong>{" "}
                {status.livemode ? "(live)" : "(test mode)"}
              </div>
            ) : null}
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", margin: "6px 0 10px" }}>
              1. Log in at <strong>dashboard.stripe.com</strong> &nbsp;·&nbsp; 2.
              Click <strong>Developers → API keys</strong> &nbsp;·&nbsp; 3. Under
              &ldquo;Secret key&rdquo; click <strong>Reveal</strong> and copy it
              (starts with <code>sk_live_</code>) &nbsp;·&nbsp; 4. Paste it below.
              The key is stored securely and never shown again.
            </div>
            <div className="admin-form-actions" style={{ marginTop: 0 }}>
              <input
                type="password"
                placeholder="sk_live_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                style={{ flex: 1, minWidth: 260 }}
                aria-label="Stripe secret key"
              />
              <button
                type="button"
                className="btn-purple"
                disabled={pending || key.trim().length < 12}
                onClick={() =>
                  run(async () => {
                    const res = await connectStripe(key);
                    if (res.ok) setKey("");
                    return res;
                  })
                }
              >
                {status.connected ? "Replace key" : "Connect Stripe"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 — webhook */}
      <div
        className="admin-form"
        style={{ maxWidth: "none", marginBottom: 16, opacity: step < 2 ? 0.55 : 1 }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <StepBadge done={status.webhookConfigured} n={2} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Turn on automatic membership updates
            </div>
            <div style={{ fontSize: 12.5, color: "var(--mid-gray)", margin: "6px 0 10px" }}>
              This registers a secure webhook in your Stripe account so payments,
              renewals, and cancellations update member access here instantly —
              one click, nothing to copy.
            </div>
            <div className="admin-form-actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn-purple"
                disabled={pending || !status.connected}
                onClick={() => run(() => setupStripeWebhook())}
              >
                {status.webhookConfigured ? "Re-run setup" : "Set up automatically"}
              </button>
              <button
                type="button"
                className="btn-mini"
                onClick={() => setShowManual((v) => !v)}
              >
                {showManual ? "Hide manual option" : "Prefer to do it manually?"}
              </button>
            </div>
            {showManual && (
              <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginTop: 10 }}>
                In Stripe: <strong>Developers → Webhooks → Add endpoint</strong>.
                Endpoint URL: <code>{status.webhookUrl}</code>. Select events:{" "}
                <code>checkout.session.completed</code>,{" "}
                <code>customer.subscription.updated</code>,{" "}
                <code>customer.subscription.deleted</code>,{" "}
                <code>invoice.payment_failed</code>. Then copy the{" "}
                <strong>Signing secret</strong> (whsec_…) and paste it here:
                <div className="admin-form-actions" style={{ marginTop: 8 }}>
                  <input
                    type="password"
                    placeholder="whsec_…"
                    value={manualSecret}
                    onChange={(e) => setManualSecret(e.target.value)}
                    style={{ flex: 1, minWidth: 220 }}
                    aria-label="Webhook signing secret"
                  />
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={pending || !manualSecret.trim()}
                    onClick={() =>
                      run(async () => {
                        const res = await saveWebhookSecret(manualSecret);
                        if (res.ok) setManualSecret("");
                        return res;
                      })
                    }
                  >
                    Save secret
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Done */}
      {step === 3 && (
        <div className="admin-hint" style={{ borderColor: "var(--accent-green)" }}>
          <strong>Stripe is connected and syncing.</strong> Set or adjust
          prices in the grid above, then members can subscribe and change plans
          from their Profile page (and the renewal page when a membership
          lapses). Two follow-ups inside Stripe when you have a minute: turn on
          the <strong>Customer portal</strong> (Settings → Billing → Customer
          portal → Save) so members can update cards and cancel themselves, and
          add your logo under Settings → Branding so checkout looks like
          Momentum+.
        </div>
      )}
    </div>
  );
}
