"use client";

import { useState, useTransition } from "react";
import { pullSpeakersFromTsls } from "@/app/(portal)/admin/speakers/actions";

/* One-click TSLS → Momentum+ speaker pull (Matt, 2026-08-05): main-stage
   speakers and panelists come across; the Emcee is skipped by rule.
   Listings only — no accounts created, no emails sent. */
export function PullTslsSpeakersButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await pullSpeakersFromTsls();
            setStatus({
              ok: res.ok,
              text: res.message ?? (res.ok ? "Done" : "Something went wrong"),
            });
          })
        }
      >
        {pending ? "Pulling…" : "Pull speakers from TSLS"}
      </button>
      {status && (
        <span
          style={{
            fontSize: 12.5,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
          }}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}
