import { strict as assert } from "node:assert";
import { test } from "node:test";
import { easternInputToIso, isoToEasternInput } from "../lib/eastern-time";

test("EST (winter): 2 PM ET is 7 PM UTC", () => {
  assert.equal(easternInputToIso("2026-01-15T14:00"), "2026-01-15T19:00:00.000Z");
});

test("EDT (summer): 2 PM ET is 6 PM UTC", () => {
  assert.equal(easternInputToIso("2026-07-15T14:00"), "2026-07-15T18:00:00.000Z");
});

test("round-trip is exact in both seasons", () => {
  for (const input of [
    "2026-01-15T14:00",
    "2026-07-15T14:00",
    "2026-03-08T01:59", // minutes before spring-forward
    "2026-11-01T00:30", // the night of fall-back
    "2026-12-31T23:45",
  ]) {
    const iso = easternInputToIso(input);
    assert.ok(iso, `parses ${input}`);
    assert.equal(isoToEasternInput(iso), input, `round-trips ${input}`);
  }
});

test("re-saving a rendered value never shifts the instant", () => {
  const stored = "2026-07-16T18:00:00.000Z"; // 2 PM EDT
  const rendered = isoToEasternInput(stored);
  assert.equal(easternInputToIso(rendered), stored);
});

test("empty and malformed input", () => {
  assert.equal(easternInputToIso(""), null);
  assert.equal(easternInputToIso("not-a-date"), null);
  assert.equal(isoToEasternInput(null), "");
  assert.equal(isoToEasternInput("garbage"), "");
});
