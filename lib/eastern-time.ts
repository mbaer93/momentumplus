/*
 * Eastern Time <-> UTC conversion for admin-entered session times.
 *
 * Session times are ET everywhere in the product (cards, reminders, .ics all
 * pin America/New_York), so the admin form's <input type="datetime-local">
 * values are defined to be ET wall time. Parsing them with `new Date()` on
 * the server interprets them in the SERVER's timezone (UTC on Vercel) and
 * silently shifts every session by the ET offset — and re-saving shifts it
 * again. These helpers make the round-trip exact regardless of where the
 * server or the admin's browser lives.
 */

const ET = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function wallPartsAt(at: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Midnight can format as hour 24 with hourCycle h24 quirks.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Milliseconds ET is offset from UTC at a given instant (negative). */
function etOffsetMs(at: Date): number {
  const p = wallPartsAt(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - at.getTime();
}

/**
 * "YYYY-MM-DDTHH:mm" (datetime-local value, ET wall time) → UTC ISO string.
 * Returns null for empty/malformed input.
 */
export function easternInputToIso(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The ET offset depends on the instant we're solving for; two passes
  // converge including across DST transitions.
  let ts = wallAsUtc - etOffsetMs(new Date(wallAsUtc));
  ts = wallAsUtc - etOffsetMs(new Date(ts));
  return new Date(ts).toISOString();
}

/** UTC ISO string → "YYYY-MM-DDTHH:mm" ET wall time for datetime-local. */
export function isoToEasternInput(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const p = wallPartsAt(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
