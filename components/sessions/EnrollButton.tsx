"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  enrollInSession,
  unenrollFromSession,
} from "@/app/(portal)/sessions/actions";
import { CheckIcon } from "@/components/icons";

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
    // NOT the red "cancelled" styling (audit P2-22): a full session is a
    // popularity signal, not a failure — and members deserve a next step.
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          className="status-pill"
          style={{
            padding: "8px 14px",
            background: "var(--gold-pale)",
            color: "var(--gold-text)",
          }}
        >
          Session full
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>
          Spots reopen if someone unenrolls — check back, or browse{" "}
          <Link href="/sessions" style={{ color: "var(--gold-text)", fontWeight: 600 }}>
            other sessions
          </Link>
          .
        </span>
      </div>
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
            ? { background: "rgba(255,255,255,0.12)", color: "var(--white)" }
            : undefined
        }
      >
        {pending ? (
          enrolled ? (
            "Cancelling…"
          ) : (
            "Enrolling…"
          )
        ) : enrolled ? (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <CheckIcon size={14} />
            Enrolled · tap to cancel
          </span>
        ) : (
          "Enroll"
        )}
      </button>
      {message && (
        <span
          role="status"
          style={{
            fontSize: 12,
            color: isError ? "var(--accent-red-light)" : "var(--gold-light)",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
