// Minimal RFC 5545 .ics (VCALENDAR/VEVENT) generator. Pure — unit-tested in
// tests/ics.test.ts. Used by /api/sessions/[id]/ics for "Add to Calendar".

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  durationMin: number;
  organizerName?: string;
  organizerEmail?: string;
  /** RFC 5545 recurrence rule (e.g. "FREQ=WEEKLY") — the whole series
      imports in one event. Built via rruleFor() in lib/recurrence.ts. */
  rrule?: string;
  /** Pin the event to a wall-clock timezone (DTSTART;TZID=…). Without it,
      times are UTC — fine for one-offs, but a recurring 7 PM ET series
      would drift an hour at every DST change. Only America/New_York ships
      a VTIMEZONE definition today. */
  tzid?: string;
  /** DTSTAMP override — tests pin it for deterministic output. */
  stamp?: Date;
}

// ICS date-time in UTC: 20260218T160000Z
function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// ICS local wall time in a named zone: 20260218T110000 (no Z).
function toIcsLocal(date: Date, tzid: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour"); // midnight quirk
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

// US Eastern with the standard 2007+ DST rules — enough forever forward.
const VTIMEZONE_NEW_YORK = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

// Escape per RFC 5545 §3.3.11 (commas, semicolons, backslashes, newlines).
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold lines longer than 75 octets (RFC 5545 §3.1) — continuation starts with a space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 74) {
    parts.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  if (remaining.length) parts.push(" " + remaining);
  return parts.join("\r\n");
}

export function buildIcs(event: IcsEvent): string {
  const end = new Date(event.start.getTime() + event.durationMin * 60 * 1000);
  // Real DTSTAMP: calendar clients reconcile re-imports by it, and a 1970
  // stamp makes some refuse to update a changed event.
  const stamp = toIcsUtc(event.stamp ?? new Date());
  // Only zones we carry a VTIMEZONE for may be referenced by TZID.
  const tzid = event.tzid === "America/New_York" ? event.tzid : null;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Momentum+//Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(tzid ? VTIMEZONE_NEW_YORK : []),
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    tzid
      ? `DTSTART;TZID=${tzid}:${toIcsLocal(event.start, tzid)}`
      : `DTSTART:${toIcsUtc(event.start)}`,
    tzid
      ? `DTEND;TZID=${tzid}:${toIcsLocal(end, tzid)}`
      : `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];

  if (event.rrule) {
    lines.push(`RRULE:${event.rrule}`);
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${escapeText(event.url)}`);
  }
  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeText(event.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
