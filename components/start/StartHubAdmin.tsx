"use client";

import { useState } from "react";
import { saveStartHubSettings } from "@/app/start/actions";

/* Admin-only controls at the bottom of /start: flip the TSLS App between
   open season and closed, and edit the closed-season note. */
export function StartHubAdmin({
  tslsOpen,
  closedNote,
}: {
  tslsOpen: boolean;
  closedNote: string;
}) {
  const [open, setOpen] = useState(tslsOpen);
  const [note, setNote] = useState(closedNote);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto 40px",
        padding: "16px 18px",
        border: "1px dashed var(--gold)",
        borderRadius: 4,
        background: "rgba(184, 150, 90, 0.05)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--gold)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Admin only — TSLS App season
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={open ? "open" : "closed"}
          onChange={(e) => setOpen(e.target.value === "open")}
          aria-label="TSLS App season"
          style={{
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 13,
            background: "var(--cream)",
          }}
        >
          <option value="open">TSLS App is open</option>
          <option value="closed">TSLS App is closed</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note shown while closed"
          aria-label="Closed-season note"
          style={{
            flex: "1 1 280px",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 13,
            background: "var(--cream)",
          }}
        />
        <button
          type="button"
          className="btn-gold"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            let res: Awaited<ReturnType<typeof saveStartHubSettings>>;
            try {
              res = await saveStartHubSettings({ tslsOpen: open, closedNote: note });
            } catch {
              res = { ok: false, message: "Couldn't reach the server — try again." };
            }
            setSaving(false);
            setStatus({ ok: res.ok, text: res.message ?? (res.ok ? "Saved" : "Couldn't save") });
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
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
