"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAllPricing, type PricingInput } from "@/app/(portal)/admin/billing/actions";

/*
 * One-stop pricing: every self-serve price (Member + Pro, Monthly and
 * 3/6/12-month terms) on one grid, edited and saved together. Term inputs
 * take the TOTAL charged per term; per-month and savings compute live.
 */

type TermKey = "3" | "6" | "12";
const TERMS: { key: TermKey; label: string; months: number }[] = [
  { key: "3", label: "3-Month", months: 3 },
  { key: "6", label: "6-Month", months: 6 },
  { key: "12", label: "12-Month", months: 12 },
];

export interface PricingInitial {
  monthly: number | null;
  terms: Record<TermKey, number | null>;
}

interface PlanForm {
  monthly: string;
  terms: Record<TermKey, string>;
}

function toForm(initial: PricingInitial): PlanForm {
  return {
    monthly: initial.monthly != null ? String(initial.monthly) : "",
    terms: {
      "3": initial.terms["3"] != null ? String(initial.terms["3"]) : "",
      "6": initial.terms["6"] != null ? String(initial.terms["6"]) : "",
      "12": initial.terms["12"] != null ? String(initial.terms["12"]) : "",
    },
  };
}

function money(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export function PricingManager({
  connected,
  livemode,
  basic,
  pro,
}: {
  connected: boolean;
  livemode: boolean;
  basic: PricingInitial;
  pro: PricingInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forms, setForms] = useState<{ basic: PlanForm; pro: PlanForm }>({
    basic: toForm(basic),
    pro: toForm(pro),
  });

  function setMonthly(plan: "basic" | "pro", v: string) {
    setForms((f) => ({ ...f, [plan]: { ...f[plan], monthly: v } }));
  }
  function setTerm(plan: "basic" | "pro", key: TermKey, v: string) {
    setForms((f) => ({
      ...f,
      [plan]: { ...f[plan], terms: { ...f[plan].terms, [key]: v } },
    }));
  }

  function save() {
    setMsg(null);
    const toInput = (f: PlanForm) => ({
      monthly: Number(f.monthly),
      terms: {
        "3": f.terms["3"].trim() ? Number(f.terms["3"]) : null,
        "6": f.terms["6"].trim() ? Number(f.terms["6"]) : null,
        "12": f.terms["12"].trim() ? Number(f.terms["12"]) : null,
      },
    });
    const input: PricingInput = { basic: toInput(forms.basic), pro: toInput(forms.pro) };
    startTransition(async () => {
      try {
        const res = await saveAllPricing(input);
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "That didn't save — try again." });
      }
    });
  }

  const monthlyValid =
    Number(forms.basic.monthly) > 0 && Number(forms.pro.monthly) > 0;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 15 }}>Pricing</h3>
        {connected && (
          <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
            {livemode ? "Live Stripe account" : "Stripe test mode"}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--mid-gray)", margin: "4px 0 14px" }}>
        Set every plan and term here, then save once. Monthly is the price per
        month; term boxes are the <strong>total</strong> charged for that term
        (leave a term blank to not offer it). Changing a price creates a fresh
        Stripe price and retires the old one — current subscribers keep their
        rate, new sign-ups get the new one.
      </p>

      {!connected && (
        <div className="admin-hint" style={{ marginBottom: 12 }}>
          Connect your Stripe account below before setting prices.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {(["basic", "pro"] as const).map((plan) => {
          const f = forms[plan];
          const monthly = Number(f.monthly);
          return (
            <div key={plan} className="admin-form" style={{ maxWidth: "none", border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                {plan === "basic" ? "Momentum+ Member" : "Momentum+ Pro"}
              </div>
              <div className="admin-field">
                <label htmlFor={`${plan}-monthly`}>Monthly price ($/month)</label>
                <input
                  id={`${plan}-monthly`}
                  type="number"
                  min={1}
                  step="1"
                  value={f.monthly}
                  disabled={!connected || pending}
                  onChange={(e) => setMonthly(plan, e.target.value)}
                  placeholder={plan === "basic" ? "198" : "348"}
                />
              </div>
              {TERMS.map((t) => {
                const total = Number(f.terms[t.key]);
                const perMonth = total > 0 ? total / t.months : 0;
                const savings =
                  monthly > 0 && total > 0 ? monthly * t.months - total : 0;
                return (
                  <div className="admin-field" key={t.key}>
                    <label htmlFor={`${plan}-${t.key}`}>
                      {t.label} — total for {t.months} months
                    </label>
                    <input
                      id={`${plan}-${t.key}`}
                      type="number"
                      min={0}
                      step="1"
                      value={f.terms[t.key]}
                      disabled={!connected || pending}
                      onChange={(e) => setTerm(plan, t.key, e.target.value)}
                      placeholder="leave blank to skip"
                    />
                    {total > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--mid-gray)", marginTop: 3 }}>
                        = {money(Math.round(perMonth))}/mo
                        {savings > 0 ? ` · saves ${money(savings)} vs monthly` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="admin-form-actions" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="btn-purple"
          disabled={!connected || pending || !monthlyValid}
          onClick={save}
        >
          {pending ? "Saving to Stripe…" : "Save all pricing"}
        </button>
        {!monthlyValid && connected && (
          <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
            Both plans need a monthly price.
          </span>
        )}
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
