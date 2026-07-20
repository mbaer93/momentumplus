/*
 * TSLS Summit companion — pure domain logic (no server imports so the unit
 * tests can load this file directly, same as lib/membership.ts).
 *
 * The Summit section is the phone-first companion to the in-person event:
 * agenda, vendors, speakers, community, and each attendee's own ticket.
 * Registration itself stays exactly where it is today — attendees land in
 * the live Google Sheet and flow in through the existing /api/import/tsls
 * cron; the companion only reads what that pipeline already records.
 */

export type AgendaKind =
  | "keynote"
  | "session"
  | "workshop"
  | "panel"
  | "break"
  | "meal"
  | "networking"
  | "registration"
  | "other";

export interface AgendaItem {
  id: string;
  title: string;
  description: string;
  kind: AgendaKind;
  location: string;
  track: string;
  speakerId: string | null;
  speakerName: string;
  startsAt: string; // UTC ISO
  endsAt: string | null;
  vipOnly: boolean;
  published: boolean;
}

export interface VendorItem {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  booth: string;
  website: string | null;
  logoUrl: string | null;
  offer: string;
}

/** Event settings, admin-editable (app_settings key "summit"). Defaults
    below reflect thetsls.com as of July 2026. */
export interface SummitSettings {
  name: string;
  tagline: string;
  venue: string;
  address: string;
  /** "YYYY-MM-DD" (ET wall date) — one-day events use the same start/end. */
  startDate: string;
  endDate: string;
  hoursLabel: string;
  eventYear: number;
  websiteUrl: string;
  /** Where new attendees register (feeds the live Google Sheet). */
  registrationUrl: string;
  /** Where an existing attendee upgrades their ticket (e.g. to VIP).
      Falls back to registrationUrl when unset. */
  upgradeUrl: string;
  /**
   * The Momentum+ gift is announced ON STAGE at the event — until an admin
   * flips this, the app shows no Momentum+ anywhere (Matt, 2026-07-20:
   * "we do not want to push momentum at all until we announce").
   */
  momentumAnnounced: boolean;
}

export const SUMMIT_DEFAULTS: SummitSettings = {
  name: "The Tri-State Leadership Summit",
  tagline: "Lead with clarity, confidence, and strategic focus",
  venue: "The Maryland Theatre",
  address: "21 S Potomac St, Hagerstown, MD 21740",
  startDate: "2026-10-14",
  endDate: "2026-10-14",
  hoursLabel: "8:00 AM – 5:00 PM ET",
  eventYear: 2026,
  websiteUrl: "https://thetsls.com",
  registrationUrl: "https://event.tristateleadershipsummit.com/register-general",
  upgradeUrl: "",
  momentumAnnounced: false,
};

/** Merge a stored partial settings object over the defaults. */
export function mergeSummitSettings(
  stored: Partial<SummitSettings> | null | undefined,
): SummitSettings {
  const merged = { ...SUMMIT_DEFAULTS, ...(stored ?? {}) };
  // Blank strings in stored settings must not erase a usable default.
  for (const key of Object.keys(SUMMIT_DEFAULTS) as (keyof SummitSettings)[]) {
    if (key === "eventYear") continue;
    if (typeof merged[key] === "string" && !(merged[key] as string).trim()) {
      (merged as Record<string, unknown>)[key] = SUMMIT_DEFAULTS[key];
    }
  }
  const year = Number(merged.eventYear);
  merged.eventYear = Number.isInteger(year) && year > 2000
    ? year
    : Number(merged.startDate.slice(0, 4)) || SUMMIT_DEFAULTS.eventYear;
  // The settings form round-trips values as strings; "false" must not
  // count as announced.
  merged.momentumAnnounced =
    merged.momentumAnnounced === true ||
    (merged.momentumAnnounced as unknown) === "true";
  return merged;
}

// ---------------------------------------------------------------------------
// Agenda helpers (times are shown in ET everywhere, like sessions)
// ---------------------------------------------------------------------------

const ET = "America/New_York";

/** ET calendar date key for grouping, e.g. "2026-10-14". */
export function agendaDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function agendaDayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function agendaTimeLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-US", {
      timeZone: ET,
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(" ", " ");
}

export interface AgendaDay {
  key: string;
  label: string;
  items: AgendaItem[];
}

/** Group items into ET days, each day sorted by start time. */
export function groupAgendaByDay(items: AgendaItem[]): AgendaDay[] {
  const days = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const key = agendaDayKey(item.startsAt);
    const list = days.get(key) ?? [];
    list.push(item);
    days.set(key, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayItems]) => ({
      key,
      label: agendaDayLabel(key),
      items: dayItems.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
}

/** A block with no end time occupies a default 60 minutes on the timeline. */
export const DEFAULT_BLOCK_MIN = 60;

export type AgendaStatus = "past" | "live" | "upcoming";

export function agendaStatus(
  item: Pick<AgendaItem, "startsAt" | "endsAt">,
  now: number = Date.now(),
): AgendaStatus {
  const start = new Date(item.startsAt).getTime();
  const end = item.endsAt
    ? new Date(item.endsAt).getTime()
    : start + DEFAULT_BLOCK_MIN * 60_000;
  if (now < start) return "upcoming";
  if (now < end) return "live";
  return "past";
}

/** The "Happening now / Up next" pair for the summit home screen. */
export function currentAndNext(
  items: AgendaItem[],
  now: number = Date.now(),
): { current: AgendaItem | null; next: AgendaItem | null } {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const current =
    sorted.find((i) => agendaStatus(i, now) === "live") ?? null;
  const next =
    sorted.find((i) => agendaStatus(i, now) === "upcoming") ?? null;
  return { current, next };
}

export const AGENDA_KIND_LABELS: Record<AgendaKind, string> = {
  keynote: "Keynote",
  session: "Session",
  workshop: "Workshop",
  panel: "Panel",
  break: "Break",
  meal: "Meal",
  networking: "Networking",
  registration: "Check-in",
  other: "",
};

// ---------------------------------------------------------------------------
// Admin time entry — "9:00 AM" ET wall time → the datetime-local shape that
// lib/eastern-time.ts converts exactly (DST-safe) into UTC.
// ---------------------------------------------------------------------------

/** "9:00 AM" / "1 PM" / "13:00" → "HH:mm" (24h), or null when unparseable. */
export function parseTimeTo24h(input: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(input);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  if (minute > 59) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    if (mer === "pm" && hour !== 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}`;
}

/** "2026-10-14" + "9:00 AM" → datetime-local string for easternInputToIso. */
export function agendaLocalInput(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const t = parseTimeTo24h(time);
  return t ? `${date.trim()}T${t}` : null;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface SummitTicket {
  eventYear: number;
  registrationType: string;
  registeredAt: string;
}

/** VIP Leadership Experience (or any VIP-flavored type from the sheet). */
export function isVipRegistration(registrationType: string): boolean {
  return registrationType.toLowerCase().includes("vip");
}

/**
 * The Momentum+ gift that comes with a ticket (announced at the event):
 * general registration = 1 month, VIP = 3 months, both at member level.
 */
export function momentumGiftMonths(registrationType: string): number {
  return isVipRegistration(registrationType) ? 3 : 1;
}

/** Human label for a raw sheet registration type. */
export function ticketTypeLabel(registrationType: string): string {
  const t = registrationType.trim();
  if (!t) return "General Admission";
  return t
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Payload encoded in the check-in QR — matches the attendee's row in the
    registration sheet (email is the join key the whole pipeline uses). */
export function ticketQrPayload(
  ticket: Pick<SummitTicket, "eventYear" | "registrationType">,
  email: string,
): string {
  return `TSLS${ticket.eventYear}|${email}|${ticket.registrationType}`;
}
