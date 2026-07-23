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

/**
 * The k-th occurrence of a series (k=0 is the start), keeping the ET wall
 * time constant. Computed from the START each time — NOT by stepping the
 * previous occurrence — so a monthly "31st" series clamps to short months
 * (Feb 28) yet RETURNS to the 31st afterward instead of permanently
 * drifting to the 28th.
 */
function occurrenceAt(startIso: string, recurrence: Recurrence, k: number): string {
  const wall = isoToEasternInput(startIso); // "YYYY-MM-DDTHH:mm" ET
  const [date, time] = wall.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (recurrence === "weekly") dt.setUTCDate(dt.getUTCDate() + 7 * k);
  else if (recurrence === "biweekly") dt.setUTCDate(dt.getUTCDate() + 14 * k);
  else {
    // Monthly: anchor on the series start's day-of-month, clamped to the
    // target month's length.
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + k);
    const daysInTarget = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0),
    ).getUTCDate();
    dt.setUTCDate(Math.min(d, daysInTarget));
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${time}`;
  return easternInputToIso(next) ?? startIso;
}

const MAX_STEPS = 1200; // generous backstop; never reached in practice

/**
 * The current-or-next occurrence of a series: the first occurrence whose END
 * is still in the future (so an in-progress occurrence counts as "now").
 * Returns null when the series has fully ended (past recurrence_until).
 *
 * Fast-forwards near `now` before scanning so an ancient start (years back)
 * can't exhaust the loop bound and wrongly report the series as ended.
 */
export function nextOccurrence(
  startIso: string,
  durationMin: number,
  recurrence: Recurrence,
  untilIso: string | null,
  now: number = Date.now(),
): string | null {
  const untilMs = untilIso ? new Date(untilIso).getTime() : null;
  const startMs = new Date(startIso).getTime();
  // Estimate how many whole periods sit between the series start and now, so
  // we begin scanning at the right neighborhood rather than stepping from an
  // old start through hundreds of iterations.
  const periodDays =
    recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 30;
  let k = 0;
  if (now > startMs) {
    const elapsedDays = (now - startMs) / (24 * 60 * 60 * 1000);
    k = Math.max(0, Math.floor(elapsedDays / periodDays) - 1);
  }
  for (let i = 0; i < MAX_STEPS; i++, k++) {
    const occ = occurrenceAt(startIso, recurrence, k);
    const occMs = new Date(occ).getTime();
    if (untilMs !== null && occMs > untilMs) return null;
    if (occMs + durationMin * 60_000 >= now) return occ;
  }
  return null;
}

/**
 * The most recent occurrence START at or before `now` (the one currently
 * running or just finished). Null before the series begins. Used by the
 * attendance/recording cron: windowing recurring rows on their STATIC
 * starts_at excluded every occurrence after the first from attendance.
 */
export function lastOccurrenceStart(
  startIso: string,
  recurrence: Recurrence,
  untilIso: string | null,
  now: number = Date.now(),
): string | null {
  const untilMs = untilIso ? new Date(untilIso).getTime() : null;
  const startMs = new Date(startIso).getTime();
  if (now < startMs) return null;
  const periodDays =
    recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 30;
  let k = Math.max(
    0,
    Math.floor((now - startMs) / (24 * 60 * 60 * 1000) / periodDays) - 2,
  );
  let last: string | null = null;
  for (let i = 0; i < MAX_STEPS; i++, k++) {
    const occ = occurrenceAt(startIso, recurrence, k);
    const occMs = new Date(occ).getTime();
    if (untilMs !== null && occMs > untilMs) break;
    if (occMs > now) break;
    last = occ;
  }
  return last;
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
  for (let k = 0; k < MAX_STEPS && out.length < 100; k++) {
    const occ = occurrenceAt(startIso, recurrence, k);
    const startMs = new Date(occ).getTime();
    if (untilMs !== null && startMs > untilMs) break;
    if (startMs > toMs) break;
    if (startMs >= fromMs) out.push(occ);
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
