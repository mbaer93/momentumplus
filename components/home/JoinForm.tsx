"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { startPublicCheckout } from "@/app/join/actions";

/**
 * Public signup form: name + email + plan → Stripe Checkout. The account is
 * created automatically after payment (invite email → set password).
 */
export type TermMap = Record<string, number | null | undefined>;

export function JoinForm({
  initialPlan,
  terms,
  referralCode,
}: {
  initialPlan: "basic" | "pro";
  /** Referral code from /join?ref=… — attributed at checkout. */
  referralCode?: string;
  /** Configured billing terms per plan: months -> total USD (1 = monthly). */
  terms?: { basic: TermMap; pro: TermMap };
}) {
  const [plan, setPlan] = useState<"basic" | "pro">(initialPlan);
  const [months, setMonths] = useState(1);
  const planTerms: [number, number | null][] = [1, 3, 6, 12]
    .filter((m) => m === 1 || (terms?.[plan]?.[String(m)] ?? null) !== null)
    .map((m) => [m, m === 1 ? (terms?.[plan]?.["1"] ?? null) : (terms?.[plan]?.[String(m)] ?? null)]);
  const planName = plan === "pro" ? "Momentum+ Pro" : "Momentum+ Member";
  const selectedTotal = planTerms.find(([m]) => m === months)?.[1] ?? null;
  const perMonth = selectedTotal != null ? Math.round(selectedTotal / months) : null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setExisting(false);
    startTransition(async () => {
      try {
        const res = await startPublicCheckout({ plan, email, name, months, ref: referralCode });
        if (res.ok && res.url) {
          window.location.href = res.url;
          return;
        }
        setMsg(res.message ?? "Something went wrong — try again.");
        setExisting(Boolean(res.existingAccount));
      } catch {
        setMsg("Something went wrong — try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="join-form">
      <div className="join-plan-row">
        {(["basic", "pro"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`join-plan${plan === p ? " active" : ""}`}
            onClick={() => setPlan(p)}
          >
            {p === "basic" ? "Momentum+ Member" : "Momentum+ Pro"}
          </button>
        ))}
      </div>
      {planTerms.length > 1 && (
        <div className="join-terms" role="radiogroup" aria-label="Billing term">
          {planTerms.map(([m, usd]) => {
            const per = usd != null ? Math.round(usd / m) : null;
            const monthlyRef = terms?.[plan]?.["1"] ?? null;
            const save =
              usd != null && monthlyRef != null ? monthlyRef * m - usd : 0;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={months === m}
                className={`join-term${months === m ? " active" : ""}`}
                onClick={() => setMonths(m)}
              >
                {save > 0 && <span className="join-term-tag">Save ${save}</span>}
                <span className="join-term-name">
                  {m === 1 ? "Monthly" : `${m} months`}
                </span>
                {per != null && (
                  <span className="join-term-per">${per}/mo</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="join-price-box">
        {selectedTotal != null ? (
          <>
            <div className="join-price-head">
              <span className="join-price-amount">${perMonth}</span>
              <span className="join-price-unit">/mo</span>
            </div>
            <p className="join-price-note">
              {planName} —{" "}
              {months === 1
                ? `$${selectedTotal} billed monthly`
                : `$${selectedTotal} billed every ${months} months`}
              . Renews automatically; cancel anytime from your profile.
            </p>
          </>
        ) : (
          <p className="join-price-note">
            Your price is confirmed on the secure Stripe checkout before you pay.
          </p>
        )}
      </div>
      <div className="admin-field">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First and last name"
          required
        />
      </div>
      <div className="admin-field">
        <label htmlFor="join-email">Email</label>
        <input
          id="join-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
        />
      </div>
      <button type="submit" className="btn-gold land-cta" disabled={pending}>
        {pending ? "Opening secure checkout…" : "Continue to payment"}
      </button>
      {msg && (
        <div className="admin-form-msg err" style={{ marginTop: 10 }}>
          {msg}{" "}
          {existing && (
            <Link href="/login" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Log in
            </Link>
          )}
        </div>
      )}
      <p className="join-fine">
        Payment is handled securely by Stripe. After checkout, look for your
        welcome email — it sets up your login.
      </p>
    </form>
  );
}
