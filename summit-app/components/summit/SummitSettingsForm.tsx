"use client";

import { useState, useTransition } from "react";
import { updateSummitSettings } from "@/app/(app)/admin/actions";
import type { SummitSettings } from "@/lib/summit";

const FIELDS: { key: keyof SummitSettings; label: string; placeholder?: string }[] = [
  { key: "name", label: "Event name" },
  { key: "tagline", label: "Tagline" },
  { key: "venue", label: "Venue" },
  { key: "address", label: "Address" },
  { key: "startDate", label: "Start date (YYYY-MM-DD)", placeholder: "2026-10-14" },
  { key: "endDate", label: "End date (YYYY-MM-DD)", placeholder: "2026-10-14" },
  { key: "hoursLabel", label: "Hours label", placeholder: "8:00 AM – 5:00 PM ET" },
  { key: "eventYear", label: "Event year (matches the registration import)" },
  { key: "websiteUrl", label: "Event website URL" },
  { key: "registrationUrl", label: "Registration URL (new attendees)" },
  {
    key: "upgradeUrl",
    label: "Ticket upgrade URL (blank = use registration URL)",
    placeholder: "https://…",
  },
];

export function SummitSettingsForm({ initial }: { initial: SummitSettings }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key] ?? "")])),
  );
  const [announced, setAnnounced] = useState(initial.momentumAnnounced);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateSummitSettings({
        ...values,
        eventYear: Number(values.eventYear) || initial.eventYear,
        momentumAnnounced: announced,
      } as Partial<SummitSettings>);
      setMsg({ text: res.message ?? (res.ok ? "Saved" : "Error"), ok: res.ok });
    });
  }

  return (
    <form onSubmit={save}>
      <div
        className="admin-field-row"
        style={{ gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}
      >
        {FIELDS.map((f) => (
          <div className="admin-field" key={f.key}>
            <label htmlFor={`summit-${f.key}`}>{f.label}</label>
            <input
              id={`summit-${f.key}`}
              value={values[f.key]}
              placeholder={f.placeholder}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>

      <div className="tsls-card" style={{ marginBottom: 16 }}>
        <label
          className="admin-check-row"
          htmlFor="summit-momentumAnnounced"
          style={{ fontWeight: 600 }}
        >
          <input
            id="summit-momentumAnnounced"
            type="checkbox"
            className="pref-toggle"
            checked={announced}
            onChange={(e) => setAnnounced(e.target.checked)}
          />
          The Momentum+ gift has been announced on stage
        </label>
        <p className="tsls-admin-note" style={{ marginTop: 8, marginBottom: 0 }}>
          Until this is checked, the app shows nothing about Momentum+
          anywhere. Flip it during the announcement: the header button and
          the &quot;your ticket includes Momentum+ access&quot; cards appear
          for everyone immediately (general = 1 month, VIP = 3 months,
          member level).
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="submit" className="btn-sm-gold" disabled={pending}>
          {pending ? "Saving…" : "Save event settings"}
        </button>
        {msg && (
          <span
            style={{
              fontSize: 13,
              color: msg.ok ? "var(--accent-green)" : "var(--accent-red)",
            }}
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
