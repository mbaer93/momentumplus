"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  enrollInSession,
  unenrollFromSession,
} from "@/app/(portal)/sessions/actions";

export function EnrollButton({
  sessionId,
  initialEnrolled,
  full = false,
}: {
  sessionId: string;
  initialEnrolled: boolean;
  /** Session at capacity (and viewer not enrolled): render a disabled
      "Session full" state instead of a button that fails on click. */
  full?: boolean;
}) {
  const [enrolled, setEnrolled] = useState(initialEnrolled);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const wasEnrolled = enrolled;
      const res = enrolled
        ? await unenrollFromSession(sessionId)
        : await enrollInSession(sessionId);
      if (res.ok) {
        setEnrolled(!wasEnrolled);
        // Always confirm the outcome — real (non-preview) enrollment used to
        // change silently, leaving a first-timer unsure it worked.
        setMessage(
          wasEnrolled
            ? "You're no longer enrolled."
            : "You're in — we'll remind you. The live room opens 30 min before start.",
        );
        router.refresh();
      } else {
        setIsError(true);
        setMessage(res.message ?? "Something went wrong — try again.");
      }
    });
  }

  if (full && !enrolled) {
    return (
      <span className="status-pill cancelled" style={{ padding: "8px 14px" }}>
        Session full
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        className={enrolled ? "btn-ghost" : "btn-gold"}
        onClick={toggle}
        disabled={pending}
        style={
          enrolled
            ? { background: "rgba(255,255,255,0.12)", color: "#fff" }
            : undefined
        }
      >
        {pending
          ? "…"
          : enrolled
            ? "✓ Enrolled · tap to cancel"
            : "Enroll"}
      </button>
      {message && (
        <span
          style={{
            fontSize: 12,
            color: isError ? "#e08585" : "var(--gold-light)",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
