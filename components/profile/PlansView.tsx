"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { openBillingPortal, startCheckout } from "@/app/(portal)/profile/billing-actions";
import type { TermMap } from "@/components/home/JoinForm";

/*
 * /upgrade — the in-portal plans page: Member vs Pro benefits comparison
 * with every configured billing term, plus billing management (card,
 * plan switch, cancel — all through the Stripe customer portal). Members
 * with a live subscription who pick another plan are routed to the portal
 * so the switch prorates instead of double-billing (startCheckout handles
 * that server-side).
 */

const MEMBER_BENEFITS = [
  "Live monthly leadership session (online, via Zoom)",
  "Full recording library with AI takeaways",
  "Core courses with certificates of completion",
  "Private member community",
  "Member tools, resources, and offers",
];
const PRO_BENEFITS = [
  "Everything in Momentum+ Member",
  "Pro-only live sessions and workshops",
  "Pro-only recordings in the library",
  "Advanced course tracks and premium resources",
  "First access to new programs",
];

export interface PlansViewProps {
  /** Stripe connected via the Admin → Billing wizard. */
  enabled: boolean;
  /** Configured billing terms per plan: months -> total USD (1 = monthly). */
  terms: { basic: TermMap; pro: TermMap };
  /** The viewer's live Stripe plan (active/past-due subscription), if any. */
  stripePlan: "basic" | "pro" | null;
  /** Viewer holds pro-level access (paid Pro, sponsor, or admin). */
  isPro: boolean;
  /** Viewer holds ANY active membership (paid or comp). Same rule as the
      profile's BillingControls: never sell Basic to someone whose access is
      already covered — a second checkout double-bills for nothing (their
      higher/equal grant already wins). */
  hasActiveMembership: boolean;
  hasCustomer: boolean;
  tierLabel: string;
  /** The avatar menu's Billing entry couldn't open the Stripe portal and
      fell back here — say why instead of arriving silently. */
  billingNotice?: boolean;
}

function TermPicker({
  plan,
  terms,
  months,
  onPick,
}: {
  plan: string;
  terms: TermMap;
  months: number;
  onPick: (m: number) => void;
}) {
  const options: [number, number | null][] = [1, 3, 6, 12]
    .filter((m) => m === 1 || (terms[String(m)] ?? null) !== null)
    .map((m) => [m, terms[String(m)] ?? null]);
  if (options.length <= 1) return null;
  const monthlyRef = terms["1"] ?? null;
  return (
    <div className="join-terms" role="radiogroup" aria-label={`${plan} billing term`}>
      {options.map(([m, usd]) => {
        const per = usd != null ? Math.round(usd / m) : null;
        const save = usd != null && monthlyRef != null ? monthlyRef * m - usd : 0;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={months === m}
            className={`join-term${months === m ? " active" : ""}`}
            onClick={() => onPick(m)}
          >
            {m === 12 && <span className="join-term-flag">Best value</span>}
            <span className="join-term-name">{m === 1 ? "Monthly" : `${m} Months`}</span>
            {per != null && (
              <span className="join-term-per">
                <strong>${per}</strong>/mo
              </span>
            )}
            {m > 1 && usd != null ? (
              <span className="join-term-total">${usd} total</span>
            ) : (
              <span className="join-term-total">billed monthly</span>
            )}
            <span className={`join-term-save${save > 0 ? "" : " none"}`}>
              {save > 0 ? `Save $${save}` : " "}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PlansView({
  enabled,
  terms,
  stripePlan,
  isPro,
  hasActiveMembership,
  hasCustomer,
  tierLabel,
  billingNotice = false,
}: PlansViewProps) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [basicMonths, setBasicMonths] = useState(1);
  const [proMonths, setProMonths] = useState(1);
  const msgRef = useRef<HTMLDivElement | null>(null);

  // The error banner sits above the cards — scroll it into view, or a
  // failed checkout looks like the button silently did nothing.
  useEffect(() => {
    if (msg) msgRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [msg]);

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

  if (!enabled) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 560 }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Plans &amp; upgrades</h3>
        <p style={{ fontSize: 13, color: "var(--mid-gray)", marginBottom: 12 }}>
          Online billing isn&apos;t switched on yet — reach out and we&apos;ll
          take care of your plan personally.
        </p>
        <a
          className="btn-sm-gold"
          href="mailto:hello@momentumplus.co?subject=Momentum%2B%20membership%20change"
        >
          Contact the Momentum+ team
        </a>
      </div>
    );
  }

  // What the button on each card does depends on where the member stands.
  interface Cta {
    label: string;
    disabled?: boolean;
    plan?: "basic" | "pro";
  }
  const basicCta: Cta =
    stripePlan === "basic"
      ? { label: "Your current plan", disabled: true }
      : stripePlan === "pro"
        ? { label: "Switch to Member", plan: "basic" as const }
        : isPro
          ? { label: `Included with your ${tierLabel} access`, disabled: true }
          : hasActiveMembership
            ? { label: `Covered by your ${tierLabel} access`, disabled: true }
            : { label: "Choose Member", plan: "basic" as const };
  const proCta: Cta =
    stripePlan === "pro"
      ? { label: "Your current plan", disabled: true }
      : isPro && !stripePlan
        ? { label: `Included with your ${tierLabel} access`, disabled: true }
        : { label: stripePlan === "basic" ? "Upgrade to Pro" : "Choose Pro", plan: "pro" as const };

  const monthly = (plan: "basic" | "pro") => terms[plan]["1"] ?? null;

  return (
    <>
      {billingNotice && (
        <div className="admin-hint" style={{ marginBottom: 14, maxWidth: 720 }}>
          {hasCustomer
            ? "We couldn't open your billing portal just now — try again in a moment. If it keeps happening, contact the Momentum+ team."
            : "No billing profile on this account yet — choose a plan below, and billing management (card, invoices, cancellation) unlocks after your first payment."}
        </div>
      )}
      {msg && (
        <div ref={msgRef} className="admin-form-msg err" style={{ marginBottom: 14 }}>
          {msg}
        </div>
      )}
      <div className="plans-grid">
        {(
          [
            {
              key: "basic" as const,
              name: "Momentum+ Member",
              benefits: MEMBER_BENEFITS,
              months: basicMonths,
              setMonths: setBasicMonths,
              cta: basicCta,
              best: false,
            },
            {
              key: "pro" as const,
              name: "Momentum+ Pro",
              benefits: PRO_BENEFITS,
              months: proMonths,
              setMonths: setProMonths,
              cta: proCta,
              best: true,
            },
          ]
        ).map((p) => (
          <div key={p.key} className={`card plan-card${p.best ? " best" : ""}`}>
            {p.best && <span className="pricing-best-tag">Most Access</span>}
            <div className="plan-card-name">{p.name}</div>
            <div className="plan-card-price">
              {monthly(p.key) != null ? `$${monthly(p.key)}/mo` : "Membership"}
            </div>
            <ul className="plan-card-list">
              {p.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {!p.cta.disabled && (
              <TermPicker
                plan={p.name}
                terms={terms[p.key]}
                months={p.months}
                onPick={p.setMonths}
              />
            )}
            <button
              type="button"
              className={p.best ? "btn-gold" : "btn-primary"}
              style={{ width: "100%", marginTop: 12, padding: "10px 14px" }}
              disabled={pending || Boolean(p.cta.disabled)}
              onClick={() => {
                const plan = p.cta.plan;
                if (!p.cta.disabled && plan) {
                  go(() => startCheckout(plan, p.months));
                }
              }}
            >
              {pending && !p.cta.disabled ? "Opening secure checkout…" : p.cta.label}
            </button>
            {!p.cta.disabled && stripePlan && (
              <p style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 8 }}>
                You have an active subscription, so this opens your secure
                billing portal — the switch prorates automatically.
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Billing management: card, plan switches, cancellation. */}
      <div className="card" style={{ padding: 20, marginTop: 18, maxWidth: 720 }}>
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Billing &amp; cancellation</h3>
        {hasCustomer ? (
          <>
            <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 12 }}>
              Update your card, download invoices, change your plan, or cancel
              your subscription — everything happens in your secure Stripe
              billing portal. If you cancel, you keep access through the end
              of the period you already paid for.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-sm-gold"
                disabled={pending}
                onClick={() => go(() => openBillingPortal())}
              >
                Update card &amp; billing info
              </button>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => go(() => openBillingPortal())}
              >
                Cancel subscription
              </button>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
            {isPro
              ? `Your ${tierLabel} access is provided for you, so there's nothing to bill — no card on file, nothing to cancel.`
              : "No billing profile yet — choose a plan above and your billing portal opens up after your first payment."}
          </p>
        )}
      </div>
    </>
  );
}
