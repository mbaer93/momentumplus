"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/*
 * First-steps guided tour (Matt, 2026-07-20): a new member lands on a
 * dashboard of zeros with no obvious first move. This card walks them
 * through the portal one step at a time — the current step is expanded
 * with a description and a "Take me there" button; finished steps get a
 * check. Enrollment and notification prefs are verified server-side;
 * visit-style steps mark complete when the member takes the trip (stored
 * per device). Fully dismissable, and gone for good once completed.
 */

interface StepDef {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

const STEPS: StepDef[] = [
  {
    key: "enroll",
    title: "Enroll in your first session",
    description:
      "Live sessions are the heart of Momentum+. Pick one that fits your calendar — you'll get a reminder before it starts, and the room opens right here in the portal.",
    href: "/sessions",
    cta: "Browse sessions",
  },
  {
    key: "community",
    title: "Say hello in the Community",
    description:
      "Introduce yourself in #general — who you are, what you do, and what you're working on. This community is the room you'll grow in all year.",
    href: "/community",
    cta: "Open the Community",
  },
  {
    key: "library",
    title: "Explore the Session Library",
    description:
      "Every session is recorded and lands here with AI takeaways and space for your private notes — miss a live session and nothing is lost.",
    href: "/library",
    cta: "Browse the Library",
  },
  {
    key: "prefs",
    title: "Choose how we keep you posted",
    description:
      "Set your notification preferences — session reminders, new recordings, community replies. Email and in-app are on by default; text messages only if you opt in.",
    href: "/profile",
    cta: "Set my preferences",
  },
];

const DONE_KEY = "mp_tour_done";
const DISMISS_KEY = "mp_tour_dismissed";

function loadLocal(): Set<string> {
  try {
    return new Set(
      JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

function CheckMark({ done }: { done: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="9"
        cy="9"
        r="8"
        stroke={done ? "var(--gold, #B8965A)" : "var(--warm-gray, #E8E4DC)"}
        strokeWidth="1.5"
        fill={done ? "var(--gold, #B8965A)" : "none"}
      />
      {done && (
        <path
          d="M5.5 9.2 8 11.5l4.5-5"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}

export function GettingStarted({
  enrolled,
  prefsSaved,
}: {
  /** Server truth: the member has at least one enrollment (ever). */
  enrolled: boolean;
  /** Server truth: the member has saved notification preferences. */
  prefsSaved: boolean;
}) {
  const router = useRouter();
  // localStorage is per-device and only readable client-side — render
  // nothing until mounted so the server and client HTML agree.
  const [ready, setReady] = useState(false);
  const [localDone, setLocalDone] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setLocalDone(loadLocal());
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    setReady(true);
  }, []);

  const isDone = (key: string) =>
    key === "enroll"
      ? enrolled || localDone.has(key)
      : key === "prefs"
        ? prefsSaved || localDone.has(key)
        : localDone.has(key);

  const doneCount = STEPS.filter((s) => isDone(s.key)).length;
  const current = STEPS.find((s) => !isDone(s.key)) ?? null;

  if (!ready || dismissed || !current) return null;

  const go = (step: StepDef) => {
    // Visiting counts as taking the step — enrollment and prefs flip to
    // server truth on the next dashboard load anyway.
    const next = new Set(localDone);
    next.add(step.key);
    window.localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
    setLocalDone(next);
    router.push(step.href);
  };

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h3 style={{ fontSize: 15 }}>
          Getting started{" "}
          <span
            style={{ fontSize: 12, color: "var(--mid-gray)", fontWeight: 400 }}
          >
            {doneCount} of {STEPS.length} done
          </span>
        </h3>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--mid-gray)",
            textDecoration: "underline",
            padding: 0,
          }}
        >
          Skip the tour
        </button>
      </div>
      {STEPS.map((step) => {
        const done = isDone(step.key);
        const active = current.key === step.key;
        return (
          <div
            key={step.key}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "8px 0",
              borderTop: "1px solid var(--warm-gray, #E8E4DC)",
              opacity: done || active ? 1 : 0.55,
            }}
          >
            <CheckMark done={done} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  textDecoration: done ? "line-through" : "none",
                  color: done ? "var(--mid-gray)" : "inherit",
                }}
              >
                {step.title}
              </div>
              {active && (
                <>
                  <p
                    style={{
                      fontSize: 12.5,
                      color: "var(--mid-gray)",
                      margin: "4px 0 10px",
                      lineHeight: 1.55,
                      maxWidth: 560,
                    }}
                  >
                    {step.description}
                  </p>
                  <button
                    type="button"
                    className="btn-sm-gold"
                    onClick={() => go(step)}
                  >
                    {step.cta}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
