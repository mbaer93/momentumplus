/*
 * One place that turns an instant into words (Matt, 2026-08-21).
 *
 * Two rules, and they are not the same rule:
 *
 *  - A TIME OF DAY belongs to whoever is reading it. A member in Denver
 *    should see 6:00 PM MDT for the session that starts at 8:00 PM ET, and
 *    when they fly in for the event their laptop switches to Eastern and
 *    the times follow it. Nothing detects the travel; the device already
 *    knows.
 *  - A CALENDAR DATE on its own belongs to the event. "The September 12
 *    session" is September 12 for everybody, and localising a bare date
 *    would show a member on the west coast a different day than the one
 *    printed on their ticket.
 *
 * Where a date and a time are shown together they must come from the SAME
 * zone, or the pair contradicts itself. Callers get that for free by
 * asking for one combined style rather than composing two.
 *
 * Every style pins a timeZone. A toLocaleString with no timeZone formats in
 * whatever zone the *renderer* happens to be in — UTC on Vercel, the
 * member's own zone in the browser — so the server and the client disagree
 * about what they produced and React throws the tree away (#418, live on
 * /admin/security on 2026-08-21). That bug is the reason this file exists.
 */

/** The event's zone. TSLS is a Tri-State program; everything anchors here. */
export const EVENT_TZ = "America/New_York";

export type TimeStyle =
  /** Aug 21, 2026 */
  | "date"
  /** August 21, 2026 */
  | "dateLong"
  /** Aug 21 */
  | "monthDay"
  /** Aug 2026 */
  | "monthYear"
  /** AUG — the big date block on a session card */
  | "monthAbbr"
  /** 21 */
  | "dayOfMonth"
  /** 2026 */
  | "year"
  /** 7:00 PM EDT */
  | "time"
  /** 7:00 PM — no zone name. Only for times that are ALWAYS the reader's
      own, like a chat timestamp, where naming the zone is noise. */
  | "timeBare"
  /** Aug 21, 2026, 7:00 PM EDT */
  | "dateTime"
  /** Aug 21, 7:00 PM EDT */
  | "monthDayTime";

const STYLES: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  date: { month: "short", day: "numeric", year: "numeric" },
  dateLong: { month: "long", day: "numeric", year: "numeric" },
  monthDay: { month: "short", day: "numeric" },
  monthYear: { month: "short", year: "numeric" },
  monthAbbr: { month: "short" },
  dayOfMonth: { day: "numeric" },
  year: { year: "numeric" },
  /*
   * timeZoneName on every style that shows a clock, without exception.
   * "6:00 PM" alone is worse than useless to a member in Denver: it reads
   * as the session time and they miss it by two hours. "short" also gives
   * the seasonally correct EDT/EST rather than a hardcoded one that is
   * wrong for eight months of the year.
   */
  time: { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
  timeBare: { hour: "numeric", minute: "2-digit" },
  dateTime: {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
  monthDayTime: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
};

/** Styles that show a clock, and so belong to the reader rather than the event. */
const CLOCK_STYLES: ReadonlySet<TimeStyle> = new Set<TimeStyle>([
  "time",
  "timeBare",
  "dateTime",
  "monthDayTime",
]);

export function showsAClock(style: TimeStyle): boolean {
  return CLOCK_STYLES.has(style);
}

/**
 * Format an instant in an explicit zone.
 *
 * `timeZone` is a required-by-default parameter with a deliberate value
 * rather than an optional one, so that forgetting it lands on the event's
 * zone instead of on the renderer's.
 */
export function formatAt(
  at: string | number | Date,
  style: TimeStyle,
  timeZone: string = EVENT_TZ,
): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const text = new Intl.DateTimeFormat("en-US", {
    ...STYLES[style],
    timeZone: safeZone(timeZone),
  }).format(date);
  return style === "monthAbbr" ? text.toUpperCase() : text;
}

/**
 * A zone Intl will actually accept.
 *
 * An unknown IANA name throws a RangeError, and the browser is not the only
 * source of these — a stale device, an exotic build of Chromium, or a
 * proxied header can all offer something Node has never heard of. Falling
 * back beats a formatting crash inside a render.
 */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return EVENT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return EVENT_TZ;
  }
}

/**
 * The zone the reader's device is in, or null on the server.
 *
 * Never called during render — see components/LocalTime.tsx for why the
 * answer has to arrive after mount rather than during it.
 */
export function viewerTimeZone(): string | null {
  if (typeof Intl === "undefined") return null;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
