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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
        const res = await startPublicCheckout({
          plan,
          email,
          name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          months,
          ref: referralCode,
        });
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
      {planTerms.length > 1 ? (
        <div className="join-terms" role="radiogroup" aria-label="Billing term">
          {planTerms.map(([m, usd]) => {
            const per = usd != null ? Math.round(usd / m) : null;
            const monthlyRef = terms?.[plan]?.["1"] ?? null;
            const save =
              usd != null && monthlyRef != null ? monthlyRef * m - usd : 0;
            const best = m === 12;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={months === m}
                className={`join-term${months === m ? " active" : ""}`}
                onClick={() => setMonths(m)}
              >
                {best && <span className="join-term-flag">Best value</span>}
                <span className="join-term-name">
                  {m === 1 ? "Monthly" : `${m} Months`}
                </span>
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
                  {save > 0 ? `Save $${save}` : " "}
                </span>
              </button>
            );
          })}
        </div>
      ) : selectedTotal != null ? (
        <div className="join-price-solo">
          <span className="join-price-amount">${perMonth}</span>
          <span className="join-price-unit">/mo</span>
        </div>
      ) : null}
      <p className="join-price-summary">
        {selectedTotal != null ? (
          <>
            <strong>{planName}</strong> —{" "}
            {months === 1
              ? `$${selectedTotal}/month`
              : `$${selectedTotal} every ${months} months ($${perMonth}/mo)`}
            . Renews automatically; cancel anytime from your profile.
          </>
        ) : (
          "Your price is confirmed on the secure Stripe checkout before you pay."
        )}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="admin-field">
          <label htmlFor="join-first">First name</label>
          <input
            id="join-first"
            name="given-name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jane"
            required
          />
        </div>
        <div className="admin-field">
          <label htmlFor="join-last">Last name</label>
          <input
            id="join-last"
            name="family-name"
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Rivers"
            required
          />
        </div>
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
