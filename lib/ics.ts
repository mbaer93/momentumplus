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
  /** DTSTAMP override — tests pin it for deterministic output. */
  stamp?: Date;
}

// ICS date-time in UTC: 20260218T160000Z
function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

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

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Momentum+//Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(event.start)}`,
    `DTEND:${toIcsUtc(end)}`,
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
