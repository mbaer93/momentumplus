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
import { CalendarSmallIcon, ClockIcon, TimerIcon, UsersIcon } from "@/components/icons";

const STATUS_LABEL: Record<string, string> = {
  live: "Live Now",
  upcoming: "Upcoming",
  enrolled: "Enrolled",
  attended: "Attended",
  past: "Completed",
};

const STATUS_PILL: Record<string, string> = {
  live: "live",
  upcoming: "upcoming",
  enrolled: "enrolled",
  attended: "attended",
  past: "attended",
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
  const countLabel =
    status === "attended" || status === "past"
      ? `${session.enrolledCount} attended`
      : `${session.enrolledCount} enrolled`;

  return (
    <div className={`session-card${isLive ? " live" : ""}`}>
      <div className="session-card-header">
        <div className={`session-cat ${categoryClass(session.category)}`}>
          {session.category}
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
          <Link
            href={`/sessions/${session.slug}/live`}
            className="card-btn btn-card-live"
          >
            Join Session Now
          </Link>
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
              <Link
                href={`/sessions/${session.slug}/live`}
                className="card-btn btn-card-zoom"
              >
                Join Zoom
              </Link>
            ) : (
              <Link
                href={`/sessions/${session.slug}`}
                className="card-btn btn-card-secondary"
              >
                Details
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
