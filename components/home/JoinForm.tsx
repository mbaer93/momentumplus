"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { startPublicCheckout } from "@/app/join/actions";

/**
 * Public signup form: name + email + plan → Stripe Checkout. The account is
 * created automatically after payment (invite email → set password).
 */
export function JoinForm({ initialPlan }: { initialPlan: "basic" | "pro" }) {
  const [plan, setPlan] = useState<"basic" | "pro">(initialPlan);
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
        const res = await startPublicCheckout({ plan, email, name });
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
            {p === "basic" ? "Momentum+ User" : "Momentum+ Pro"}
          </button>
        ))}
      </div>
      <div className="admin-field">
        <label htmlFor="join-name">Your name</label>
        <input
          id="join-name"
          type="text"
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
          type="email"
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
