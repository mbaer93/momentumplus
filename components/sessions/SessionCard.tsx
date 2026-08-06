import Link from "next/link";
import type { SessionDetail } from "@/lib/types";
import { displayCategory } from "@/lib/programs";
import {
  categoryClass,
  dateLabel,
  displayStatus,
  durationLabel,
  isJoinWindowOpen,
  timeLabel,
} from "@/lib/sessions/view";
import { CalendarSmallIcon, ClockIcon, TimerIcon, UsersIcon } from "@/components/icons";
import { isDropInProgram } from "@/lib/programs";
import { rruleFor } from "@/lib/recurrence";
import { AddToCalendarButton } from "./AddToCalendarButton";

const STATUS_LABEL: Record<string, string> = {
  live: "Live Now",
  upcoming: "Upcoming",
  enrolled: "Enrolled",
  attended: "Attended",
  past: "Completed",
  cancelled: "Cancelled",
  draft: "Draft",
};

const STATUS_PILL: Record<string, string> = {
  live: "live",
  upcoming: "upcoming",
  enrolled: "enrolled",
  attended: "attended",
  past: "attended",
  cancelled: "cancelled",
  draft: "draft",
};

export function SessionCard({
  session,
  now,
}: {
  session: SessionDetail;
  now: number;
}) {
  const status = displayStatus(session, now);
  const isLive = status === "live";
  const joinable = isJoinWindowOpen(session, now) && session.isEnrolled;
  const full =
    session.capacity !== null && session.enrolledCount >= session.capacity;
  const countLabel =
    status === "attended" || status === "past"
      ? `${session.enrolledCount} enrolled`
      : session.capacity
        ? `${session.enrolledCount} of ${session.capacity} enrolled${full && !session.isEnrolled ? " — full" : ""}`
        : `${session.enrolledCount} enrolled`;

  return (
    <div className={`session-card${isLive ? " live" : ""}`}>
      <div className="session-card-header">
        <div className={`session-cat ${categoryClass(displayCategory(session))}`}>
          {displayCategory(session)}
        </div>
        <div className="session-status-badge">
          <span className={`status-pill ${STATUS_PILL[status]}`}>
            {isLive ? "● " : ""}
            {STATUS_LABEL[status]}
          </span>
        </div>
        <h3>
          <Link href={`/sessions/${session.slug}`}>{session.title}</Link>
        </h3>
        <div className="session-card-speaker">{session.speaker.name}</div>
      </div>
      <div className="session-card-body">
        <div className="session-meta">
          <div className="session-meta-item">
            <CalendarSmallIcon size={12} />{" "}
            <strong>{dateLabel(session.startsAt)}</strong>
          </div>
          <div className="session-meta-item">
            <ClockIcon size={12} /> <strong>{timeLabel(session.startsAt)}</strong>
          </div>
          <div className="session-meta-item">
            <TimerIcon size={12} /> {durationLabel(session.durationMin)}
          </div>
          <div className="session-meta-item">
            <UsersIcon size={12} /> {countLabel}
          </div>
        </div>
      </div>
      <div className="session-card-footer">
        {isLive && session.isEnrolled ? (
          /* Plain <a>, NOT <Link>: the live room needs a full document load
             so its SharedArrayBuffer isolation headers apply (fast Zoom
             video) and the Zoom singleton boots fresh for this session. */
          <a
            href={`/sessions/${session.slug}/live`}
            className="card-btn btn-card-live"
          >
            Join Session Now
          </a>
        ) : (
          <>
            <Link
              href={`/sessions/${session.slug}`}
              className="card-btn btn-card-primary"
            >
              {status === "attended" || status === "past"
                ? "View Notes & Summary"
                : "View Details"}
            </Link>
            {joinable ? (
              /* Plain <a> — see the live-entry note above. */
              <a
                href={`/sessions/${session.slug}/live`}
                className="card-btn btn-card-zoom"
              >
                Join Zoom
              </a>
            ) : session.isEnrolled || isDropInProgram(session.program) ? (
              /* "Add to calendar" — a distinct second action, not a second
                 button to the same detail page. Same Google/Outlook/Apple
                 menu as the detail page. Only enrolled members (or drop-in
                 programs, which need no enrollment) can add to calendar —
                 Matt, 2026-08-05. */
              <AddToCalendarButton
                slug={session.slug}
                title={session.title}
                description={session.description}
                startsAt={session.startsAt}
                durationMin={session.durationMin}
                joinUrl={session.zoomJoinUrl}
                rrule={
                  session.recurrence
                    ? rruleFor(session.recurrence, session.recurrenceUntil, session.startsAt)
                    : null
                }
                buttonClassName="card-btn btn-card-secondary"
                label="Add to calendar"
                withIcon={false}
                grow
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
