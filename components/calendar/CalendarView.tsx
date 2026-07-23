"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/*
 * Month-view calendar per mockup §calendar: grid on the left, upcoming
 * events + legend on the right. Events come from real sessions; clicking
 * one opens its session page.
 */

export interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  category: string;
  program?: string;
  speakerName: string;
  isEnrolled: boolean;
}

type EventColor = "blue" | "green" | "gold" | "purple" | "neutral";

/* Legend follows the session taxonomy (Sierra, 2026-07-22). Rooted Focus
   is always a Productivity Session regardless of its stored category;
   legacy categories fold into the nearest new bucket. */
function colorFor(e: CalendarEvent): EventColor {
  if (e.program === "rooted_focus") return "gold";
  switch (e.category) {
    case "Accountability Session":
      return "green";
    case "Productivity Session":
      return "gold";
    case "AI Leadership Lab":
      return "purple";
    case "Bonus Sessions":
    case "Networking":
      return "neutral";
    default:
      return "blue"; // Monthly Educational Session + legacy categories
  }
}

const LEGEND: { color: EventColor; swatch: string; label: string }[] = [
  { color: "blue", swatch: "rgba(58,107,150,0.15)", label: "Monthly Educational Session" },
  { color: "green", swatch: "rgba(58,112,85,0.12)", label: "Accountability Session" },
  { color: "gold", swatch: "var(--gold-pale)", label: "Productivity Session" },
  { color: "purple", swatch: "rgba(92,61,122,0.14)", label: "AI Leadership Lab" },
  { color: "neutral", swatch: "rgba(11,22,34,0.08)", label: "Bonus Sessions" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/*
 * Events are pinned to their EASTERN calendar day, matching every other
 * time label in the product. Keying by the browser's local date put an
 * 8 PM ET session on the wrong grid day for anyone outside Eastern time.
 */
const ET_DAY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function etDayKey(iso: string | Date): string {
  const parts = ET_DAY_PARTS.formatToParts(
    typeof iso === "string" ? new Date(iso) : iso,
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return `${get("year")}-${Number(get("month")) - 1}-${Number(get("day"))}`;
}

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const router = useRouter();
  const now = new Date();
  // Open on the EASTERN current month — for a viewer in another timezone
  // near midnight ET, the browser-local month can differ and would open a
  // month where the "today" ring isn't visible.
  const [etNowYear, etNowMonth] = etDayKey(now).split("-").map(Number);
  const [year, setYear] = useState(etNowYear);
  const [month, setMonth] = useState(etNowMonth); // 0-based

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = etDayKey(e.startsAt);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [events]);

  // 6 fixed weeks starting the Sunday on/before the 1st — covers every month.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return d;
    });
  }, [year, month]);

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => new Date(e.startsAt).getTime() > Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .slice(0, 5),
    [events],
  );

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const todayKey = etDayKey(now);

  return (
    <div className="calendar-layout" style={{ marginTop: 20 }}>
      <div>
        <div className="cal-header">
          <div className="cal-month-title">
            {MONTHS[month]} {year}
          </div>
          <div className="cal-nav-btns">
            <button
              type="button"
              className="cal-nav-btn"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg>
            </button>
            <button
              type="button"
              className="cal-nav-btn"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          </div>
        </div>
        <div className="cal-grid-header">
          {DAY_NAMES.map((d) => (
            <div className="cal-day-name" key={d}>
              {d}
            </div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === month;
            const dayEvents = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={`cal-cell${inMonth ? "" : " other-month"}${
                  key === todayKey ? " today" : ""
                }`}
              >
                <div className="cal-date">{d.getDate()}</div>
                {inMonth &&
                  dayEvents.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={`cal-event ${colorFor(e)}`}
                      title={`${e.title} — ${e.speakerName}`}
                      onClick={() => router.push(`/sessions/${e.slug}`)}
                    >
                      {e.title}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sidebar */}
      <div>
        <div className="cal-upcoming-title">Upcoming Events</div>
        {upcoming.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
            No upcoming sessions scheduled yet.
          </div>
        )}
        {upcoming.map((e) => {
          const d = new Date(e.startsAt);
          const dateLabel = `${d
            .toLocaleDateString("en-US", { month: "short", timeZone: "America/New_York" })
            .toUpperCase()} ${d.toLocaleDateString("en-US", {
            day: "numeric",
            timeZone: "America/New_York",
          })}, ${d.toLocaleDateString("en-US", {
            year: "numeric",
            timeZone: "America/New_York",
          })} · ${d.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
            timeZone: "America/New_York",
          })}`;
          return (
            <Link
              href={`/sessions/${e.slug}`}
              className="cal-event-item"
              key={e.id}
            >
              <div className="cal-event-date">{dateLabel}</div>
              <div className="cal-event-title">{e.title}</div>
              <div className="cal-event-speaker">{e.speakerName}</div>
              <span
                className="cal-event-type"
                style={
                  e.isEnrolled
                    ? { background: "rgba(58,107,150,0.12)", color: "var(--accent-blue)" }
                    : { background: "var(--gold-pale)", color: "var(--gold)" }
                }
              >
                {e.isEnrolled ? "Enrolled" : "Upcoming"}
              </span>
            </Link>
          );
        })}

        <div style={{ marginTop: 20 }}>
          <div className="cal-upcoming-title">Legend</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {LEGEND.map((l) => (
              <div className="cal-legend-row" key={l.color}>
                <span
                  className="cal-legend-swatch"
                  style={{ background: l.swatch }}
                />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
