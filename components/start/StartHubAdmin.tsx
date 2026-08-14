"use client";

import { useState } from "react";
import { saveStartHubSettings } from "@/app/start/actions";
import type { StartHubSettings } from "@/lib/start-hub";

/* Admin-only controls at the bottom of /start: flip the TSLS App between
   open season and closed, edit the closed-season note, and paste the App
   Store / Google Play listing links (badges appear once set). */
export function StartHubAdmin({ settings }: { settings: StartHubSettings }) {
  const [values, setValues] = useState(settings);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const inputStyle: React.CSSProperties = {
    flex: "1 1 260px",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 13,
    background: "var(--cream)",
    color: "#1c2733",
  };
  const set = (patch: Partial<StartHubSettings>) =>
    setValues((v) => ({ ...v, ...patch }));

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto 40px",
        padding: "16px 18px",
        border: "1px dashed var(--gold)",
        borderRadius: 4,
        background: "rgba(248, 246, 241, 0.96)",
        color: "#1c2733",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--gold-text)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Admin only — hub settings
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={values.tslsOpen ? "open" : "closed"}
          onChange={(e) => set({ tslsOpen: e.target.value === "open" })}
          aria-label="TSLS App season"
          style={{ ...inputStyle, flex: "0 0 auto" }}
        >
          <option value="open">TSLS App is open</option>
          <option value="closed">TSLS App is closed</option>
        </select>
        <input
          value={values.closedNote}
          onChange={(e) => set({ closedNote: e.target.value })}
          placeholder="Note shown while closed"
          aria-label="Closed-season note"
          style={inputStyle}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 8,
          marginTop: 8,
        }}
      >
        <input
          value={values.momentumAppStoreUrl}
          onChange={(e) => set({ momentumAppStoreUrl: e.target.value })}
          placeholder="Momentum+ App Store link (https://…)"
          aria-label="Momentum+ App Store link"
          style={inputStyle}
        />
        <input
          value={values.momentumPlayUrl}
          onChange={(e) => set({ momentumPlayUrl: e.target.value })}
          placeholder="Momentum+ Google Play link (https://…)"
          aria-label="Momentum+ Google Play link"
          style={inputStyle}
        />
        <input
          value={values.tslsAppStoreUrl}
          onChange={(e) => set({ tslsAppStoreUrl: e.target.value })}
          placeholder="TSLS App Store link (https://…)"
          aria-label="TSLS App Store link"
          style={inputStyle}
        />
        <input
          value={values.tslsPlayUrl}
          onChange={(e) => set({ tslsPlayUrl: e.target.value })}
          placeholder="TSLS Google Play link (https://…)"
          aria-label="TSLS Google Play link"
          style={inputStyle}
        />
        <input
          value={values.ticketsUrl}
          onChange={(e) => set({ ticketsUrl: e.target.value })}
          placeholder="Ticket page (blank = the TSLS app's own)"
          aria-label="Ticket purchase link"
          style={inputStyle}
        />
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          className="btn-gold"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            let res: Awaited<ReturnType<typeof saveStartHubSettings>>;
            try {
              res = await saveStartHubSettings(values);
            } catch {
              res = { ok: false, message: "Couldn't reach the server — try again." };
            }
            setSaving(false);
            setStatus({
              ok: res.ok,
              text: res.message ?? (res.ok ? "Saved" : "Couldn't save"),
            });
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <span style={{ fontSize: 12, color: "#5b6673" }}>
          Store badges appear under each card once a link is saved.
        </span>
      </div>
      {status && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12.5,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
