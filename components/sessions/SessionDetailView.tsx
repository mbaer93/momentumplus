"use client";

import { useMemo, useState } from "react";
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
import { AddToCalendarButton } from "./AddToCalendarButton";
import { EnrollButton } from "./EnrollButton";
import { NotesEditor } from "./NotesEditor";

type Tab = "overview" | "resources" | "ai" | "notes";

export function SessionDetailView({ session }: { session: SessionDetail }) {
  const [tab, setTab] = useState<Tab>("overview");
  const now = useMemo(() => Date.now(), []);
  const status = displayStatus(session, now);
  const joinable = isJoinWindowOpen(session, now) && session.isEnrolled;
  const isLive = status === "live";

  return (
    <div className="sess-detail-wrap">
      <Link href="/sessions" className="sess-back">
        <ArrowLeftIcon size={12} /> All sessions
      </Link>

      <div className="sess-detail-card">
        {/* Hero */}
        <div className="sess-hero">
          <div
            className={`sess-cat-badge ${categoryClass(session.category)}`}
          >
            {session.category}
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
            <div className="sess-meta-chip">
              <UsersIcon size={11} /> {session.enrolledCount} enrolled
            </div>
          </div>

          <div className="sess-cta-bar">
            {joinable || isLive ? (
              session.isEnrolled ? (
                <Link
                  href={`/sessions/${session.slug}/live`}
                  className="btn-gold"
                >
                  {isLive ? "Join Session Now" : "Enter Live Room"}
                </Link>
              ) : (
                <EnrollButton
                  sessionId={session.id}
                  initialEnrolled={session.isEnrolled}
                />
              )
            ) : status === "attended" || status === "past" ? (
              <span
                className="status-pill attended"
                style={{ padding: "8px 14px" }}
              >
                {status === "attended" ? "You attended" : "Completed"}
              </span>
            ) : (
              <EnrollButton
                sessionId={session.id}
                initialEnrolled={session.isEnrolled}
              />
            )}

            <AddToCalendarButton
              slug={session.slug}
              title={session.title}
              description={session.description}
              startsAt={session.startsAt}
              durationMin={session.durationMin}
              joinUrl={session.isEnrolled ? session.zoomJoinUrl : null}
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
            <button
              className={`sess-tab${tab === "resources" ? " active" : ""}`}
              onClick={() => setTab("resources")}
              type="button"
            >
              Resources ({session.resources.length})
            </button>
            <button
              className={`sess-tab${tab === "ai" ? " active" : ""}`}
              onClick={() => setTab("ai")}
              type="button"
            >
              AI Summary
            </button>
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

          {tab === "notes" && (
            <NotesEditor sessionId={session.id} initialNote={session.note} />
          )}
        </div>
      </div>
    </div>
  );
}
