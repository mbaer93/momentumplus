import { easternInputToIso, isoToEasternInput } from "@/lib/eastern-time";

/*
 * Recurring-session math (Rooted Focus series). All arithmetic happens on
 * Eastern wall time — a weekly 7:00 PM ET session must stay 7:00 PM ET
 * across DST transitions, which naive +7-days-in-UTC math would break.
 * Pure given explicit `now` values; unit-tested in tests/recurrence.test.ts.
 */

export type Recurrence = "weekly" | "biweekly" | "monthly";

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  weekly: "Repeats weekly",
  biweekly: "Repeats every other week",
  monthly: "Repeats monthly",
};

/** The next occurrence's start, keeping the ET wall time constant. */
function step(iso: string, recurrence: Recurrence): string {
  const wall = isoToEasternInput(iso); // "YYYY-MM-DDTHH:mm" ET
  const [date, time] = wall.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (recurrence === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (recurrence === "biweekly") dt.setUTCDate(dt.getUTCDate() + 14);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${time}`;
  return easternInputToIso(next) ?? iso;
}

const MAX_STEPS = 520; // ~10 years of weekly — loop backstop, never expected

/**
 * The current-or-next occurrence of a series: the first occurrence whose END
 * is still in the future (so an in-progress occurrence counts as "now").
 * Returns null when the series has fully ended (past recurrence_until).
 */
export function nextOccurrence(
  startIso: string,
  durationMin: number,
  recurrence: Recurrence,
  untilIso: string | null,
  now: number = Date.now(),
): string | null {
  const untilMs = untilIso ? new Date(untilIso).getTime() : null;
  let occurrence = startIso;
  for (let i = 0; i < MAX_STEPS; i++) {
    const startMs = new Date(occurrence).getTime();
    if (untilMs !== null && startMs > untilMs) return null;
    if (startMs + durationMin * 60_000 >= now) return occurrence;
    occurrence = step(occurrence, recurrence);
  }
  return null;
}

/**
 * All occurrence starts within [fromMs, toMs] — used to paint every date of
 * a series on the member calendar.
 */
export function expandOccurrences(
  startIso: string,
  recurrence: Recurrence,
  untilIso: string | null,
  fromMs: number,
  toMs: number,
): string[] {
  const untilMs = untilIso ? new Date(untilIso).getTime() : null;
  const out: string[] = [];
  let occurrence = startIso;
  for (let i = 0; i < MAX_STEPS && out.length < 100; i++) {
    const startMs = new Date(occurrence).getTime();
    if (untilMs !== null && startMs > untilMs) break;
    if (startMs > toMs) break;
    if (startMs >= fromMs) out.push(occurrence);
    occurrence = step(occurrence, recurrence);
  }
  return out;
}

/** RFC 5545 RRULE for the series (used in .ics and the Google Calendar URL). */
export function rruleFor(
  recurrence: Recurrence,
  untilIso: string | null,
): string {
  const freq =
    recurrence === "monthly"
      ? "FREQ=MONTHLY"
      : recurrence === "biweekly"
        ? "FREQ=WEEKLY;INTERVAL=2"
        : "FREQ=WEEKLY";
  if (!untilIso) return freq;
  const until = new Date(untilIso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return `${freq};UNTIL=${until}`;
}
