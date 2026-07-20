"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveSponsorProTickets,
  saveSponsorTicketCounts,
  saveSponsorTicketOverride,
} from "@/app/(portal)/admin/sponsors/actions";
import { SPONSOR_TIERS, sponsorTierLabel } from "@/lib/sponsor-tiers";

interface SponsorTicketSettingsProps {
  counts: Record<string, number>;
  /** Active sponsors, for the per-sponsor override + studio jump list. */
  sponsors: {
    id: string;
    name: string;
    tier: string;
    ticketOverride: number | null;
    /** Admin-granted full Momentum+ Pro tickets (one year each). */
    proTickets: number;
    proTicketsUsed: number;
  }[];
  isSuperAdmin: boolean;
}

/**
 * Per-tier VIP ticket allotments. Missing/0 = that tier hands out no free
 * VIP access. Owners see the allotment in their Sponsor Studio and during
 * onboarding.
 */
export function SponsorTicketSettings({
  counts,
  sponsors,
  isSuperAdmin,
}: SponsorTicketSettingsProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      SPONSOR_TIERS.map((t) => [t.value, String(counts[t.value] ?? 0)]),
    ),
  );
  const [studioTarget, setStudioTarget] = useState("");
  const [overrideTarget, setOverrideTarget] = useState("");
  const [overrideValue, setOverrideValue] = useState("");
  const [proTarget, setProTarget] = useState("");
  const [proValue, setProValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const overrideSponsor = sponsors.find((s) => s.id === overrideTarget) ?? null;
  const proSponsor = sponsors.find((s) => s.id === proTarget) ?? null;

  function runProTickets(value: number) {
    if (!proTarget) return;
    setMsg(null);
    startTransition(async () => {
      const res = await saveSponsorProTickets(proTarget, value);
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      if (res.ok) {
        setProValue("");
        router.refresh();
      }
    });
  }

  function runOverride(value: number | null) {
    if (!overrideTarget) return;
    setMsg(null);
    startTransition(async () => {
      const res = await saveSponsorTicketOverride(overrideTarget, value);
      setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved." : "Error") });
      if (res.ok) {
        setOverrideValue("");
        router.refresh();
      }
    });
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const parsed: Record<string, number> = {};
      for (const t of SPONSOR_TIERS) {
        const n = Number(values[t.value]);
        parsed[t.value] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      }
      const res = await saveSponsorTicketCounts(parsed);
      setMsg({
        ok: res.ok,
        text: res.message ?? (res.ok ? "Ticket allotments saved." : "Error"),
      });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 18 }}>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>VIP access tickets</h3>
      <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 12 }}>
        Free 3-month VIP access each sponsor tier may hand out (0 = none).
        Page owners send the invites from their Sponsor Studio or during
        onboarding.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 10,
        }}
      >
        {SPONSOR_TIERS.map((t) => (
          <div className="admin-field" key={t.value}>
            <label htmlFor={`tickets-${t.value}`}>{t.label}</label>
            <input
              id={`tickets-${t.value}`}
              type="number"
              min={0}
              max={999}
              value={values[t.value]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [t.value]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="admin-form-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-purple"
          disabled={pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save allotments"}
        </button>
        {msg && (
          <span className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
            {msg.text}
          </span>
        )}
      </div>

      {sponsors.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>
            Per-sponsor override
          </div>
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
            Give one sponsor a custom ticket count regardless of their tier.
            Clear it to fall back to the tier default.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ minWidth: 220 }}>
              <label htmlFor="override-sponsor">Sponsor</label>
              <select
                id="override-sponsor"
                value={overrideTarget}
                onChange={(e) => {
                  setOverrideTarget(e.target.value);
                  const s = sponsors.find((x) => x.id === e.target.value);
                  setOverrideValue(
                    s?.ticketOverride === null || s === undefined
                      ? ""
                      : String(s.ticketOverride),
                  );
                }}
              >
                <option value="">Choose a sponsor…</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.ticketOverride !== null ? ` (override: ${s.ticketOverride})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field" style={{ width: 120 }}>
              <label htmlFor="override-count">Tickets</label>
              <input
                id="override-count"
                type="number"
                min={0}
                max={999}
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder={
                  overrideSponsor
                    ? String(counts[overrideSponsor.tier] ?? 0)
                    : "0"
                }
              />
            </div>
            <button
              type="button"
              className="btn-mini"
              disabled={pending || !overrideTarget || overrideValue === ""}
              onClick={() => runOverride(Number(overrideValue))}
            >
              Set override
            </button>
            <button
              type="button"
              className="btn-mini"
              disabled={
                pending || !overrideTarget || overrideSponsor?.ticketOverride === null
              }
              onClick={() => runOverride(null)}
            >
              Clear (use tier default)
            </button>
          </div>
          {overrideSponsor && (
            <div style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 6 }}>
              {overrideSponsor.name} · {sponsorTierLabel(overrideSponsor.tier)} ·
              tier default {counts[overrideSponsor.tier] ?? 0} ticket
              {(counts[overrideSponsor.tier] ?? 0) === 1 ? "" : "s"}
              {overrideSponsor.ticketOverride !== null
                ? ` · current override ${overrideSponsor.ticketOverride}`
                : " · no override"}
            </div>
          )}
        </div>
      )}

      {sponsors.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>
            Momentum+ Pro tickets
          </div>
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
            Give a business a number of FULL Momentum+ Pro memberships — one
            year each — that they hand out from their Sponsor Studio. Separate
            from VIP tickets; 0 = none.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ minWidth: 220 }}>
              <label htmlFor="pro-sponsor">Sponsor</label>
              <select
                id="pro-sponsor"
                value={proTarget}
                onChange={(e) => {
                  setProTarget(e.target.value);
                  const s = sponsors.find((x) => x.id === e.target.value);
                  setProValue(s && s.proTickets > 0 ? String(s.proTickets) : "");
                }}
              >
                <option value="">Choose a sponsor…</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.proTickets > 0 ? ` (${s.proTickets} Pro)` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field" style={{ width: 120 }}>
              <label htmlFor="pro-count">Pro tickets</label>
              <input
                id="pro-count"
                type="number"
                min={0}
                max={999}
                value={proValue}
                onChange={(e) => setProValue(e.target.value)}
                placeholder="0"
              />
            </div>
            <button
              type="button"
              className="btn-mini"
              disabled={pending || !proTarget || proValue === ""}
              onClick={() => runProTickets(Number(proValue))}
            >
              Set Pro tickets
            </button>
          </div>
          {proSponsor && (
            <div style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 6 }}>
              {proSponsor.name} · {proSponsor.proTickets} granted ·{" "}
              {proSponsor.proTicketsUsed} used ·{" "}
              {Math.max(0, proSponsor.proTickets - proSponsor.proTicketsUsed)}{" "}
              remaining
            </div>
          )}
        </div>
      )}

      {isSuperAdmin && sponsors.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="admin-field" style={{ maxWidth: 380 }}>
            <label htmlFor="studio-jump">
              Manage a sponsor&apos;s team (opens their Studio as Super Admin)
            </label>
            <select
              id="studio-jump"
              value={studioTarget}
              onChange={(e) => {
                setStudioTarget(e.target.value);
                if (e.target.value) {
                  router.push(`/sponsor?sponsor=${e.target.value}`);
                }
              }}
            >
              <option value="">Choose a sponsor…</option>
              {sponsors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
