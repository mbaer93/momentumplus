"use client";

import { useState } from "react";
import Link from "next/link";
import type { SessionDetail } from "@/lib/types";
import {
  categoryClass,
  dateLabel,
  displayStatus,
  durationLabel,
  isJoinWindowOpen,
  timeLabel,
} from "@/lib/sessions/view";
import {
  ArrowLeftIcon,
  CalendarSmallIcon,
  CheckIcon,
  ClockIcon,
  DocIcon,
  ExternalIcon,
  SparkleIcon,
  TimerIcon,
  UsersIcon,
} from "@/components/icons";
import { displayCategory, isDropInProgram } from "@/lib/programs";
import { RECURRENCE_LABEL, rruleFor } from "@/lib/recurrence";
import { useNowTick } from "./useNowTick";
import { AddToCalendarButton } from "./AddToCalendarButton";
import { EnrollButton } from "./EnrollButton";
import { NotesEditor } from "./NotesEditor";

type Tab = "overview" | "resources" | "ai" | "notes";

export function SessionDetailView({ session }: { session: SessionDetail }) {
  const [tab, setTab] = useState<Tab>("overview");
  const now = useNowTick();
  const status = displayStatus(session, now);
  // Drop-in programs (Rooted Focus) need no enrollment — any member may
  // enter the live room during the join window (Sierra, 2026-07-22).
  const dropIn = isDropInProgram(session.program);
  const joinable =
    isJoinWindowOpen(session, now) && (session.isEnrolled || dropIn);
  const isLive = status === "live";
  const full =
    session.capacity !== null && session.enrolledCount >= session.capacity;

  // Drop-in sessions (Rooted Focus, Aspire2Achieve) have no shared
  // resources or AI summaries — pure co-working, back to their own tab.
  const rooted = dropIn;
  const backHref =
    session.program === "rooted_focus"
      ? "/rooted-focus"
      : session.program === "aspire"
        ? "/aspire2achieve"
        : "/sessions";
  const backLabel =
    session.program === "rooted_focus"
      ? "All Rooted Focus sessions"
      : session.program === "aspire"
        ? "All Aspire2Achieve sessions"
        : "All sessions";

  return (
    <div className="sess-detail-wrap">
      <Link href={backHref} className="sess-back">
        <ArrowLeftIcon size={12} /> {backLabel}
      </Link>

      <div className="sess-detail-card">
        {/* Hero */}
        <div className="sess-hero">
          <div
            className={`sess-cat-badge ${categoryClass(displayCategory(session))}`}
          >
            {displayCategory(session)}
          </div>
          <div className="sess-title">{session.title}</div>
          <div className="sess-meta-row">
            <div className="sess-meta-chip">
              <CalendarSmallIcon size={11} />{" "}
              <strong>{dateLabel(session.startsAt)}</strong>
            </div>
            <div className="sess-meta-chip">
              <ClockIcon size={11} /> <strong>{timeLabel(session.startsAt)}</strong>
            </div>
            <div className="sess-meta-chip">
              <TimerIcon size={11} /> {durationLabel(session.durationMin)}
            </div>
            {/* Drop-in sessions have no enrollment — a "0 enrolled" chip
                read as a broken or unpopular session. */}
            {!dropIn && (
              <div className="sess-meta-chip">
                <UsersIcon size={11} />{" "}
                {session.capacity
                  ? `${session.enrolledCount} of ${session.capacity} enrolled`
                  : `${session.enrolledCount} enrolled`}
              </div>
            )}
            {session.recurrence && (
              <div className="sess-meta-chip">
                <CalendarSmallIcon size={11} />{" "}
                <strong>{RECURRENCE_LABEL[session.recurrence]}</strong>
              </div>
            )}
          </div>

          <div className="sess-cta-bar">
            {status === "cancelled" ? (
              <span
                className="status-pill cancelled"
                style={{ padding: "8px 14px" }}
              >
                This session was cancelled
              </span>
            ) : joinable || isLive ? (
              session.isEnrolled || dropIn ? (
                /* Plain <a>, NOT <Link>: the live room needs a full document
                   load so its SharedArrayBuffer isolation headers apply
                   (fast Zoom video) and the Zoom singleton boots fresh. */
                <a
                  href={`/sessions/${session.slug}/live`}
                  className="btn-gold"
                >
                  {isLive ? "Join Session Now" : "Enter Live Room"}
                </a>
              ) : (
                <EnrollButton
                  sessionId={session.id}
                  initialEnrolled={session.isEnrolled}
                  full={full}
                />
              )
            ) : status === "attended" || status === "past" ? (
              <span
                className="status-pill attended"
                style={{ padding: "8px 14px" }}
              >
                {status === "attended" ? "You attended" : "Completed"}
              </span>
            ) : dropIn ? (
              /* No signup for drop-in programs — just tell them when the
                 door opens. */
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.85)" }}>
                Drop in — no signup needed. The live room opens here 30
                minutes before start.
              </span>
            ) : (
              <EnrollButton
                sessionId={session.id}
                initialEnrolled={session.isEnrolled}
                full={full}
              />
            )}

            {session.isEnrolled &&
              status === "enrolled" &&
              !joinable &&
              !isLive && (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                  The live room opens here 30 minutes before start.
                </span>
              )}
            <AddToCalendarButton
              slug={session.slug}
              title={session.title}
              description={session.description}
              startsAt={session.startsAt}
              durationMin={session.durationMin}
              joinUrl={
                session.isEnrolled || dropIn ? session.zoomJoinUrl : null
              }
              rrule={
                session.recurrence
                  ? rruleFor(session.recurrence, session.recurrenceUntil)
                  : null
              }
            />
          </div>
        </div>

        {/* Body */}
        <div className="sess-body">
          <div className="sess-tabs">
            <button
              className={`sess-tab${tab === "overview" ? " active" : ""}`}
              onClick={() => setTab("overview")}
              type="button"
            >
              Overview
            </button>
            {!rooted && (
              <button
                className={`sess-tab${tab === "resources" ? " active" : ""}`}
                onClick={() => setTab("resources")}
                type="button"
              >
                Resources ({session.resources.length})
              </button>
            )}
            {!rooted && (
              <button
                className={`sess-tab${tab === "ai" ? " active" : ""}`}
                onClick={() => setTab("ai")}
                type="button"
              >
                AI Summary
              </button>
            )}
            <button
              className={`sess-tab${tab === "notes" ? " active" : ""}`}
              onClick={() => setTab("notes")}
              type="button"
            >
              My Notes
            </button>
          </div>

          {tab === "overview" && (
            <div>
              <p className="sess-desc">{session.description}</p>
              {session.objectives.length > 0 && (
                <div className="sess-objectives">
                  <div className="sess-obj-title">What you&apos;ll take away</div>
                  {session.objectives.map((o) => (
                    <div className="sess-objective" key={o}>
                      <span className="sess-obj-check">
                        <CheckIcon size={14} />
                      </span>
                      {o}
                    </div>
                  ))}
                </div>
              )}
              <div className="sess-speaker-mini">
                <div
                  className="sess-speaker-mini-av"
                  style={{
                    background: session.speaker.avatarBg,
                    color: session.speaker.avatarColor,
                  }}
                >
                  {session.speaker.initials}
                </div>
                <div>
                  <div className="sess-speaker-mini-name">
                    {session.speaker.name}
                  </div>
                  <div className="sess-speaker-mini-title">
                    {session.speaker.title}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "resources" && (
            <div>
              {session.resources.length === 0 ? (
                <div className="sess-empty-note">
                  No resources have been shared for this session yet.
                </div>
              ) : (
                session.resources.map((r) => (
                  <div className="sess-resource-item" key={r.id}>
                    <div className="sess-resource-icon">
                      <DocIcon size={16} />
                    </div>
                    <div>
                      <div className="sess-resource-name">{r.name}</div>
                      <div className="sess-resource-type">{r.type}</div>
                    </div>
                    <a className="sess-resource-link" href={r.url}>
                      Open <ExternalIcon size={12} />
                    </a>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "ai" && (
            <div>
              {!session.aiSummary ? (
                <div className="sess-empty-note">
                  The AI summary is generated after the session is recorded. Check
                  back once this session is complete.
                </div>
              ) : (
                <div>
                  <div className="ai-header">
                    <SparkleIcon size={16} />
                    <div className="ai-header-text">
                      <strong>Generated by Momentum+ AI</strong> — takeaways,
                      quotes, and action items from the recording.
                    </div>
                  </div>
                  <div className="ai-section">
                    <div className="ai-section-title">Key Takeaways</div>
                    {session.aiSummary.takeaways.map((t) => (
                      <div className="ai-takeaway" key={t}>
                        {t}
                      </div>
                    ))}
                  </div>
                  {session.aiSummary.quotes.length > 0 && (
                    <div className="ai-section">
                      <div className="ai-section-title">Notable Quotes</div>
                      {session.aiSummary.quotes.map((q) => (
                        <div className="ai-quote" key={q}>
                          &ldquo;{q}&rdquo;
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ai-section">
                    <div className="ai-section-title">Action Items</div>
                    {session.aiSummary.actionItems.map((a, i) => (
                      <div className="ai-action" key={a}>
                        <span className="ai-num">{i + 1}</span>
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hidden, not unmounted — unmounting on a tab switch discarded
              whatever the notes autosave hadn't flushed yet. */}
          <div style={{ display: tab === "notes" ? undefined : "none" }}>
            <NotesEditor sessionId={session.id} initialNote={session.note} />
          </div>
        </div>
      </div>
    </div>
  );
}
