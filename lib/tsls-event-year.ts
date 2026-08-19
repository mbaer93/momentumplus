import { fetchTslsSpeakers } from "@/lib/tsls-speakers";

/*
 * Which TSLS season is the registration import writing into?
 * (Matt, 2026-08-19: "I don't want to be bound by 2026.")
 *
 * import_log is `unique (email, event_year)` — the year is what makes the
 * import idempotent, and it is also what makes it WRONG if it goes stale.
 * With TSLS_EVENT_YEAR left at 2026 when the 2027 season opens:
 *
 *   - a first-time registrant   → new email, imports fine
 *   - someone who came in 2026
 *     and registers again       → (email, 2026) already logged → SKIPPED,
 *                                 no membership granted
 *
 * New registrants keep flowing, so the totals look healthy and nothing turns
 * red on the health page. The only people who break are returning attendees:
 * the most loyal ones, failing silently, once a year.
 *
 * So the year is asked for rather than remembered. TSLS already publishes it
 * (GET /api/bridge/speakers → eventYear) and flips it when registration opens
 * (Matt, 2026-08-19), which is exactly when the import starts needing the new
 * value.
 *
 * Three sources, in order:
 *   1. the TSLS bridge — authoritative, rolls over on its own
 *   2. TSLS_EVENT_YEAR — a manual override, and the answer when the bridge
 *      is down or not yet deployed
 *   3. nothing — the import refuses to run
 *
 * Never the clock. A January run inferring "2027" from the date would open a
 * fresh idempotency scope and re-import — and re-grant — everyone from the
 * October before. Refusing is the safe failure; guessing is not.
 */

export interface EventYearResult {
  year: number | null;
  /** Where it came from — reported so a wrong year is traceable. */
  source: "tsls" | "env" | "none";
  /** Why the bridge was not used, when it wasn't. */
  note?: string;
}

/** Sanity bound shared by both sources — the summit did not run in year 7. */
export function isPlausibleEventYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2020;
}

function fromEnv(): number | null {
  const raw = Number(process.env.TSLS_EVENT_YEAR);
  return isPlausibleEventYear(raw) ? raw : null;
}

/**
 * Resolve the season to import into. Never throws — a bridge failure falls
 * through to the environment rather than taking the import down with it.
 */
export async function resolveEventYear(): Promise<EventYearResult> {
  const envYear = fromEnv();

  let note: string | undefined;
  try {
    const res = await fetchTslsSpeakers();
    if (res.ok && isPlausibleEventYear(res.eventYear)) {
      return { year: res.eventYear, source: "tsls" };
    }
    note = res.ok
      ? "TSLS did not report an event year"
      : `TSLS bridge: ${res.message}`;
  } catch (e) {
    // fetchTslsSpeakers already catches its own failures; this is belt and
    // braces so a future change there cannot make the import throw.
    note = e instanceof Error ? e.message : "TSLS unreachable";
  }

  if (envYear !== null) return { year: envYear, source: "env", note };
  return { year: null, source: "none", note };
}

/** The message shown when neither source answered. */
export function missingEventYearMessage(note?: string): string {
  return (
    "Can't tell which TSLS season to import into. The TSLS bridge didn't " +
    "answer with an event year" +
    (note ? ` (${note})` : "") +
    ", and TSLS_EVENT_YEAR is unset or invalid. Set TSLS_EVENT_YEAR (e.g. " +
    "2026) to import while the bridge is unavailable. It is deliberately not " +
    "inferred from today's date: a January run would re-import and re-grant " +
    "everyone from the October before."
  );
}
