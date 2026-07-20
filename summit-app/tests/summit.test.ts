import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaDayKey,
  agendaLocalInput,
  agendaStatus,
  currentAndNext,
  groupAgendaByDay,
  isVipRegistration,
  mergeSummitSettings,
  parseTimeTo24h,
  SUMMIT_DEFAULTS,
  ticketQrPayload,
  ticketTypeLabel,
  type AgendaItem,
} from "../lib/summit";
import { qrSvg } from "../lib/qr";

function item(overrides: Partial<AgendaItem>): AgendaItem {
  return {
    id: "x",
    title: "Item",
    description: "",
    kind: "session",
    location: "",
    track: "",
    speakerId: null,
    speakerName: "",
    startsAt: "2026-10-14T13:00:00.000Z",
    endsAt: null,
    vipOnly: false,
    published: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test("mergeSummitSettings: defaults pass through untouched", () => {
  const s = mergeSummitSettings(null);
  assert.equal(s.name, SUMMIT_DEFAULTS.name);
  assert.equal(s.eventYear, 2026);
});

test("mergeSummitSettings: stored values win, blanks fall back", () => {
  const s = mergeSummitSettings({
    venue: "New Venue",
    tagline: "   ",
    startDate: "2027-10-13",
    eventYear: undefined as unknown as number,
  });
  assert.equal(s.venue, "New Venue");
  assert.equal(s.tagline, SUMMIT_DEFAULTS.tagline); // blank never erases
  // eventYear falls back to the start date's year, not the stale default.
  assert.equal(s.eventYear, 2027);
});

// ---------------------------------------------------------------------------
// Agenda grouping + status (ET semantics)
// ---------------------------------------------------------------------------

test("agendaDayKey groups by Eastern wall date, not UTC", () => {
  // 11 PM ET on Oct 14 is 3 AM UTC on Oct 15 — must still group as Oct 14.
  assert.equal(agendaDayKey("2026-10-15T03:00:00.000Z"), "2026-10-14");
});

test("groupAgendaByDay sorts days and items chronologically", () => {
  const days = groupAgendaByDay([
    item({ id: "late", startsAt: "2026-10-14T20:00:00.000Z" }),
    item({ id: "day2", startsAt: "2026-10-15T13:00:00.000Z" }),
    item({ id: "early", startsAt: "2026-10-14T12:00:00.000Z" }),
  ]);
  assert.equal(days.length, 2);
  assert.deepEqual(
    days[0].items.map((i) => i.id),
    ["early", "late"],
  );
  assert.equal(days[1].items[0].id, "day2");
});

test("agendaStatus: upcoming → live → past, with 60-min default block", () => {
  const start = Date.parse("2026-10-14T13:00:00.000Z");
  const it = item({ startsAt: "2026-10-14T13:00:00.000Z" });
  assert.equal(agendaStatus(it, start - 1), "upcoming");
  assert.equal(agendaStatus(it, start + 1), "live");
  assert.equal(agendaStatus(it, start + 59 * 60_000), "live");
  assert.equal(agendaStatus(it, start + 61 * 60_000), "past");
  // Explicit end time wins over the default block length.
  const long = item({ endsAt: "2026-10-14T16:00:00.000Z" });
  assert.equal(agendaStatus(long, start + 2 * 3600_000), "live");
});

test("currentAndNext picks the live block and the first upcoming one", () => {
  const now = Date.parse("2026-10-14T13:30:00.000Z");
  const items = [
    item({ id: "done", startsAt: "2026-10-14T12:00:00.000Z", endsAt: "2026-10-14T12:45:00.000Z" }),
    item({ id: "live", startsAt: "2026-10-14T13:00:00.000Z", endsAt: "2026-10-14T14:15:00.000Z" }),
    item({ id: "next", startsAt: "2026-10-14T14:15:00.000Z" }),
    item({ id: "later", startsAt: "2026-10-14T18:00:00.000Z" }),
  ];
  const { current, next } = currentAndNext(items, now);
  assert.equal(current?.id, "live");
  assert.equal(next?.id, "next");
});

test("currentAndNext with nothing live", () => {
  const now = Date.parse("2026-10-14T12:50:00.000Z");
  const items = [
    item({ id: "done", startsAt: "2026-10-14T12:00:00.000Z", endsAt: "2026-10-14T12:45:00.000Z" }),
    item({ id: "next", startsAt: "2026-10-14T13:00:00.000Z" }),
  ];
  const { current, next } = currentAndNext(items, now);
  assert.equal(current, null);
  assert.equal(next?.id, "next");
});

// ---------------------------------------------------------------------------
// Admin time entry
// ---------------------------------------------------------------------------

test("parseTimeTo24h accepts 12h and 24h shapes", () => {
  assert.equal(parseTimeTo24h("9:00 AM"), "09:00");
  assert.equal(parseTimeTo24h("12:15 pm"), "12:15");
  assert.equal(parseTimeTo24h("12 AM"), "00:00");
  assert.equal(parseTimeTo24h("1 PM"), "13:00");
  assert.equal(parseTimeTo24h("13:45"), "13:45");
  assert.equal(parseTimeTo24h("8.30"), null);
  assert.equal(parseTimeTo24h("25:00"), null);
  assert.equal(parseTimeTo24h("13 PM"), null);
  assert.equal(parseTimeTo24h(""), null);
});

test("agendaLocalInput builds a datetime-local string or rejects", () => {
  assert.equal(agendaLocalInput("2026-10-14", "9:00 AM"), "2026-10-14T09:00");
  assert.equal(agendaLocalInput("10/14/2026", "9:00 AM"), null);
  assert.equal(agendaLocalInput("2026-10-14", "sometime"), null);
});

// ---------------------------------------------------------------------------
// Tickets + QR
// ---------------------------------------------------------------------------

test("ticket helpers: VIP detection, labels, QR payload", () => {
  assert.equal(isVipRegistration("VIP Leadership Experience"), true);
  assert.equal(isVipRegistration("general admission"), false);
  assert.equal(ticketTypeLabel("general admission"), "General Admission");
  assert.equal(ticketTypeLabel("  "), "General Admission");
  assert.equal(
    ticketQrPayload(
      { eventYear: 2026, registrationType: "VIP" },
      "a@b.com",
    ),
    "TSLS2026|a@b.com|VIP",
  );
});

test("qrSvg renders a scannable-looking inline SVG", () => {
  const svg = qrSvg("TSLS2026|a@b.com|VIP");
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("viewBox"));
  assert.ok(svg.includes('fill="#0B1622"')); // navy modules on white
  assert.ok(svg.length > 500); // actually contains module paths
});
