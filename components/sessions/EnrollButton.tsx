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
}: {
  sessionId: string;
  initialEnrolled: boolean;
}) {
  const [enrolled, setEnrolled] = useState(initialEnrolled);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    setMessage(null);
    startTransition(async () => {
      const res = enrolled
        ? await unenrollFromSession(sessionId)
        : await enrollInSession(sessionId);
      if (res.ok) {
        setEnrolled(!enrolled);
        if (res.preview) setMessage(res.message ?? null);
        router.refresh();
      } else {
        setMessage(res.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
        {pending ? "…" : enrolled ? "Enrolled — Cancel" : "Enroll"}
      </button>
      {message && (
        <span style={{ fontSize: 12, color: "var(--gold-light)" }}>
          {message}
        </span>
      )}
    </div>
  );
}
