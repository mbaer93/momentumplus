"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSponsorTicketCounts } from "@/app/(portal)/admin/sponsors/actions";
import { SPONSOR_TIERS } from "@/lib/sponsor-tiers";

interface SponsorTicketSettingsProps {
  counts: Record<string, number>;
  /** Active sponsors, for the "open studio as admin" jump list. */
  sponsors: { id: string; name: string }[];
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
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
