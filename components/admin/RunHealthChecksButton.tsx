"use client";

import { useState, useTransition } from "react";
import { runHealthNowAction } from "@/app/(portal)/admin/connections/health-actions";

/* "Run checks now" (Admin → Connections).
 *
 * This was a bare <form action={...}> with no pending state. The cycle
 * makes a live call to every integration and can take ten seconds or more,
 * during which the page looked completely inert — indistinguishable from a
 * dead button (Matt, 2026-08-12). Now it says it is running, and says what
 * happened when it finishes. */
export function RunHealthChecksButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn-sm-gold"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setStatus(null);
            const res = await runHealthNowAction();
            setStatus({ ok: res.ok, text: res.message });
          })
        }
      >
        {pending ? "Running checks…" : "Run checks now"}
      </button>
      {pending && (
        <span style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>
          Every service is being called for real — this takes a few seconds.
        </span>
      )}
      {!pending && status && (
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
