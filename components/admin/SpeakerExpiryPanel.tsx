"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fixSpeakerExpiryDrift } from "@/app/(portal)/admin/speakers/actions";
import type { SpeakerExpiryDrift } from "@/app/(portal)/admin/speakers/actions";

/*
 * Speakers whose portal access ends before their speaker season does
 * (2026-08-19).
 *
 * The TSLS bridge granted speakers the NEAREST October 1, which before
 * October is the same year — so speakers provisioned for the October 2026
 * summit had access ending thirteen days before it. The route was fixed,
 * but a route fix only changes what the NEXT provisioning writes; the rows
 * already stored keep the wrong date until something repairs them.
 *
 * Shown, listed by name, and applied only on a click. A silent auto-repair
 * on page load would be a bulk write to access rows that nobody asked for
 * and nobody could see happen.
 */

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export function SpeakerExpiryPanel({ rows }: { rows: SpeakerExpiryDrift[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  if (rows.length === 0 || done) return null;

  return (
    <div
      style={{
        border: "1px solid #9B3C3C",
        background: "rgba(155, 60, 60, 0.06)",
        borderRadius: 4,
        padding: "16px 18px",
        margin: "18px 0 24px",
      }}
    >
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>
        {rows.length} speaker{rows.length === 1 ? "" : "s"} lose access before
        their season ends
      </h3>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--ink-secondary)",
          marginBottom: 12,
          lineHeight: 1.55,
        }}
      >
        Their portal access was granted on the wrong clock when TSLS
        provisioned them — the nearest October 1 rather than the end of their
        speaking season. Each one below would lose Momentum+ access on the
        first date, while their speaker record runs to the second. Extending
        matches their access to their speaker record; nothing else changes.
      </p>

      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginBottom: 10 }}
        >
          {msg.text}
        </div>
      )}

      <div className="admin-table-wrap" style={{ marginBottom: 12 }}>
        <table className="admin-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.membershipId}>
                <td>
                  <div className="admin-row-title">{r.name || r.email}</div>
                  <div className="cc-sub">{r.email}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span style={{ color: "#9B3C3C", fontWeight: 600 }}>
                    {dayLabel(r.currentExpiry)}
                  </span>
                  {" → "}
                  <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                    {dayLabel(r.correctExpiry)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="btn-gold"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const res = await fixSpeakerExpiryDrift();
            setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Error") });
            if (res.ok) {
              setDone(true);
              router.refresh();
            }
          });
        }}
      >
        {pending
          ? "Extending…"
          : `Extend ${rows.length === 1 ? "this speaker" : `all ${rows.length}`} to their season end`}
      </button>
    </div>
  );
}
