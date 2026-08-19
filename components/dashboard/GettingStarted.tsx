"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GUIDE_GROUPS,
  GUIDE_STEPS,
  currentStep,
  groupProgress,
  stepDone,
  type GuideFacts,
  type GuideStepDef,
} from "@/lib/guide-steps";

/*
 * The Momentum+ guide (Matt, 2026-07-20; expanded 2026-08-18).
 *
 * Was a four-step first-run tour: find the sessions, say hello, look at the
 * library, set your prefs. It covered "find your way around" and then
 * disappeared, which left the things members actually pay for — the
 * podcast, the courses, the directory — undiscovered.
 *
 * Now twelve steps in three groups. A FINISHED GROUP COLLAPSES to one line:
 * twelve struck-through rows is a wall, and a wall is skipped. The current
 * step is expanded with its description and a button; everything else is a
 * title and a check.
 *
 * Steps and copy live in lib/guide-steps.ts. Progress is server truth where
 * the server knows (enrolled, attended, wrote a note, finished a course)
 * plus per-device visits for the rest.
 */

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

export function GettingStarted(facts: GuideFacts) {
  const router = useRouter();
  // localStorage is per-device and only readable client-side — render
  // nothing until mounted so the server and client HTML agree.
  const [ready, setReady] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  /** Groups the member opened by hand after finishing them. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVisited(loadLocal());
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    setReady(true);
  }, []);

  const current = currentStep(facts, visited);
  const doneCount = GUIDE_STEPS.filter((s) =>
    stepDone(s, facts, visited),
  ).length;

  if (!ready || dismissed || !current) return null;

  const go = (step: GuideStepDef) => {
    // Visiting counts as taking the step. The verified ones flip to server
    // truth on the next dashboard load anyway.
    const next = new Set(visited);
    next.add(step.key);
    window.localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
    setVisited(next);
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
          Making the most of Momentum+{" "}
          <span
            style={{ fontSize: 12, color: "var(--ink-secondary)", fontWeight: 400 }}
          >
            {doneCount} of {GUIDE_STEPS.length} done
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
            color: "var(--ink-secondary)",
            textDecoration: "underline",
            padding: 0,
          }}
        >
          Hide this
        </button>
      </div>

      {GUIDE_GROUPS.map((group) => {
        const { done, total } = groupProgress(group.key, facts, visited);
        const complete = done === total;
        const open = !complete || expanded.has(group.key);
        return (
          <div key={group.key} style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              // A finished group is a summary line you can open; an
              // unfinished one is a heading, and its steps are the point.
              disabled={!complete}
              style={{
                background: "none",
                border: "none",
                padding: "4px 0",
                width: "100%",
                textAlign: "left",
                cursor: complete ? "pointer" : "default",
                fontSize: 12,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                fontWeight: 600,
                color: complete ? "var(--gold-text)" : "var(--ink-secondary)",
              }}
            >
              {group.label} — {done} of {total}
              {complete ? (open ? " · hide" : " · show") : ""}
            </button>

            {open &&
              GUIDE_STEPS.filter((s) => s.group === group.key).map((step) => {
                const isDone = stepDone(step, facts, visited);
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
                      // 0.55 put the step label at 3.66:1; 0.75 keeps the
                      // "later" look while clearing AA.
                      opacity: isDone || active ? 1 : 0.75,
                    }}
                  >
                    <CheckMark done={isDone} />
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: active ? 600 : 500,
                          textDecoration: isDone ? "line-through" : "none",
                          color: isDone ? "var(--ink-secondary)" : "inherit",
                        }}
                      >
                        {step.title}
                      </div>
                      {active && (
                        <>
                          <p
                            style={{
                              fontSize: 12.5,
                              color: "var(--ink-secondary)",
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
      })}
    </div>
  );
}
