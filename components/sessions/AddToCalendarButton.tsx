"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarSmallIcon } from "@/components/icons";

/**
 * "Add to Calendar" that loads the event straight into the member's
 * calendar: Google Calendar and Outlook open prefilled in a new tab;
 * Apple Calendar opens the event via the calendar file (how macOS/iOS
 * import events). The Zoom join link rides along in every option.
 *
 * The same three-provider menu backs every "Add to Calendar" in the app —
 * session detail, session cards, dashboard — restyled per spot via
 * buttonClassName/buttonStyle.
 */
export function AddToCalendarButton({
  slug,
  title,
  description,
  startsAt,
  durationMin,
  joinUrl,
  rrule = null,
  buttonClassName = "cal-btn",
  buttonStyle,
  label = "Add to Calendar",
  withIcon = true,
  grow = false,
}: {
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  durationMin: number;
  joinUrl: string | null;
  /** RFC 5545 rule for recurring series — adds every occurrence at once. */
  rrule?: string | null;
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
  label?: string;
  withIcon?: boolean;
  /** Fill the row like a flex:1 sibling (session-card footer buttons). */
  grow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const stamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fullTitle = `Momentum+ · ${title}`;
  const details = joinUrl
    ? `${description}\n\nJoin Zoom: ${joinUrl}`
    : description;

  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(fullTitle)}` +
    `&dates=${stamp(start)}/${stamp(end)}` +
    // Anchor the event (and any recurrence) to Eastern wall time, so a
    // 7 PM ET series doesn't shift an hour at DST changes.
    "&ctz=America/New_York" +
    `&details=${encodeURIComponent(details)}` +
    `&location=${encodeURIComponent(joinUrl ?? "Momentum+ (online)")}` +
    (rrule ? `&recur=${encodeURIComponent(`RRULE:${rrule}`)}` : "");

  const outlookUrl =
    "https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose" +
    `&subject=${encodeURIComponent(fullTitle)}` +
    `&startdt=${encodeURIComponent(start.toISOString())}` +
    `&enddt=${encodeURIComponent(end.toISOString())}` +
    `&body=${encodeURIComponent(details)}` +
    `&location=${encodeURIComponent(joinUrl ?? "Momentum+ (online)")}`;

  return (
    <div className={`cal-add-wrap${grow ? " grow" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        onClick={() => setOpen((v) => !v)}
      >
        {withIcon && <CalendarSmallIcon size={12} />}
        {withIcon ? " " : null}
        {label}
      </button>
      {open && (
        <div className="cal-add-menu">
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Google Calendar
          </a>
          <a
            href={outlookUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Outlook
          </a>
          <a href={`/api/sessions/${slug}/ics`} onClick={() => setOpen(false)}>
            Apple Calendar / other
          </a>
        </div>
      )}
    </div>
  );
}
