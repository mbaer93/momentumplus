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

test("rruleFor formats frequency and UNTIL", () => {
  assert.equal(rruleFor("weekly", null), "FREQ=WEEKLY");
  assert.equal(rruleFor("biweekly", null), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(
    rruleFor("monthly", "2027-06-01T04:00:00.000Z"),
    "FREQ=MONTHLY;UNTIL=20270601T040000Z",
  );
});
