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
}: {
  initialPlan: "basic" | "pro";
  /** Configured billing terms per plan: months -> total USD (1 = monthly). */
  terms?: { basic: TermMap; pro: TermMap };
}) {
  const [plan, setPlan] = useState<"basic" | "pro">(initialPlan);
  const [months, setMonths] = useState(1);
  const planTerms: [number, number | null][] = [1, 3, 6, 12]
    .filter((m) => m === 1 || (terms?.[plan]?.[String(m)] ?? null) !== null)
    .map((m) => [m, m === 1 ? (terms?.[plan]?.["1"] ?? null) : (terms?.[plan]?.[String(m)] ?? null)]);
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
        const res = await startPublicCheckout({ plan, email, name, months });
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
      {(() => {
        const usd = planTerms.find(([m]) => m === months)?.[1] ?? null;
        return (
          <p className="join-price-line">
            {usd
              ? `${plan === "pro" ? "Momentum+ Pro" : "Momentum+ Member"} — $${usd}${
                  months === 1 ? "/month" : ` every ${months} months`
                }, renews automatically. Cancel anytime from your profile.`
              : "Final price is shown on the secure Stripe checkout before you pay."}
          </p>
        );
      })()}
      {planTerms.length > 1 && (
        <div className="admin-field">
          <label htmlFor="join-term">Billing term</label>
          <select
            id="join-term"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {planTerms.map(([m, usd]) => (
              <option key={m} value={m}>
                {m === 1 ? "Monthly" : `Every ${m} months`}
                {usd ? ` — $${usd}${m === 1 ? "/mo" : ` per ${m} mo`}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
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
