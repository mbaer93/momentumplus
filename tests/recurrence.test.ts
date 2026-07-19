import { strict as assert } from "node:assert";
import test from "node:test";
import { expandOccurrences, nextOccurrence, rruleFor } from "@/lib/recurrence";

// A Wednesday 7:00 PM ET session in late October 2026 — DST (Nov 1) sits
// right after it, so weekly stepping must hold the ET wall time.
const START = "2026-10-28T23:00:00.000Z"; // Oct 28, 7:00 PM EDT

test("weekly recurrence keeps ET wall time across the DST fall-back", () => {
  const now = new Date("2026-11-02T00:00:00Z").getTime(); // after 1st occurrence
  const next = nextOccurrence(START, 90, "weekly", null, now);
  // Nov 4, 7:00 PM EST = 00:00 UTC Nov 5 (offset changed from -4 to -5).
  assert.equal(next, "2026-11-05T00:00:00.000Z");
});

test("nextOccurrence returns the in-progress occurrence and honors until", () => {
  const during = new Date(START).getTime() + 30 * 60_000; // 30 min in
  assert.equal(nextOccurrence(START, 90, "weekly", null, during), START);

  // Until caps the series: two weeks out is past a one-week until.
  const after = new Date("2026-11-20T00:00:00Z").getTime();
  const until = "2026-11-06T00:00:00.000Z";
  assert.equal(nextOccurrence(START, 90, "weekly", until, after), null);
});

test("expandOccurrences lists series dates inside a window", () => {
  const from = new Date("2026-10-01T00:00:00Z").getTime();
  const to = new Date("2026-12-01T00:00:00Z").getTime();
  const dates = expandOccurrences(START, "biweekly", null, from, to);
  assert.deepEqual(dates, [
    "2026-10-28T23:00:00.000Z",
    "2026-11-12T00:00:00.000Z", // Nov 11 7 PM EST
    "2026-11-26T00:00:00.000Z", // Nov 25 7 PM EST
  ]);
});

test("monthly recurrence clamps to short months instead of drifting", () => {
  // Jan 31, 7:00 PM EST series: February has no 31st — the next occurrence
  // must be Feb 28, not overflow into Mar 3.
  const janStart = "2027-02-01T00:00:00.000Z"; // Jan 31, 7:00 PM EST
  const afterFirst = new Date("2027-02-05T00:00:00Z").getTime();
  const next = nextOccurrence(janStart, 90, "monthly", null, afterFirst);
  assert.equal(next, "2027-03-01T00:00:00.000Z"); // Feb 28, 7:00 PM EST
});

test("monthly on the 31st clamps short months but returns to the 31st", () => {
  const janStart = "2027-02-01T00:00:00.000Z"; // Jan 31, 7:00 PM EST
  // Window spanning Jan–Apr: Feb clamps to 28, but March returns to 31.
  const from = new Date("2027-01-01T00:00:00Z").getTime();
  const to = new Date("2027-05-01T00:00:00Z").getTime();
  const dates = expandOccurrences(janStart, "monthly", null, from, to);
  // Jan 31, Feb 28, Mar 31, Apr 30 — all 7:00 PM ET. March/April are EDT
  // (-4, DST began Mar 14) so their UTC is 23:00 the same day.
  assert.equal(dates[0], "2027-02-01T00:00:00.000Z"); // Jan 31, 7 PM EST
  assert.equal(dates[1], "2027-03-01T00:00:00.000Z"); // Feb 28, 7 PM EST
  assert.equal(dates[2], "2027-03-31T23:00:00.000Z"); // Mar 31, 7 PM EDT (returned!)
  assert.equal(dates[3], "2027-04-30T23:00:00.000Z"); // Apr 30, 7 PM EDT
});

test("nextOccurrence survives an ancient series start", () => {
  // A weekly series that started 12 years ago with no end date must still
  // resolve to an upcoming occurrence, not fall off the loop bound.
  const start = "2015-01-07T00:00:00.000Z";
  const now = new Date("2027-01-01T00:00:00Z").getTime();
  const next = nextOccurrence(start, 90, "weekly", null, now);
  assert.ok(next && new Date(next).getTime() + 90 * 60_000 >= now);
});

test("rruleFor formats frequency and UNTIL", () => {
  assert.equal(rruleFor("weekly", null), "FREQ=WEEKLY");
  assert.equal(rruleFor("biweekly", null), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(
    rruleFor("monthly", "2027-06-01T04:00:00.000Z"),
    "FREQ=MONTHLY;UNTIL=20270601T040000Z",
  );
});
