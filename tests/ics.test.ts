import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs } from "../lib/ics";

test("buildIcs produces a valid VCALENDAR/VEVENT with CRLF line endings", () => {
  const ics = buildIcs({
    uid: "session-abc@momentumplus",
    title: "Resilience Rituals",
    start: new Date("2026-02-18T16:00:00.000Z"),
    durationMin: 90,
    url: "https://zoom.us/j/123",
  });

  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("BEGIN:VEVENT\r\n"));
  assert.ok(ics.includes("END:VEVENT\r\n"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ics.includes("UID:session-abc@momentumplus"));
  assert.ok(ics.includes("DTSTART:20260218T160000Z"));
  // 90 minutes after start
  assert.ok(ics.includes("DTEND:20260218T173000Z"));
  assert.ok(ics.includes("SUMMARY:Resilience Rituals"));
  assert.ok(ics.includes("URL:https://zoom.us/j/123"));
});

test("buildIcs escapes special characters in text fields", () => {
  const ics = buildIcs({
    uid: "x",
    title: "Goals; OKRs, and more",
    description: "Line one\nLine two",
    start: new Date("2026-01-01T00:00:00.000Z"),
    durationMin: 60,
  });
  assert.ok(ics.includes("SUMMARY:Goals\\; OKRs\\, and more"));
  assert.ok(ics.includes("DESCRIPTION:Line one\\nLine two"));
});

test("buildIcs is deterministic (stable DTSTAMP)", () => {
  const args = {
    uid: "same",
    title: "Same",
    start: new Date("2026-03-01T12:00:00.000Z"),
    durationMin: 30,
  };
  assert.equal(buildIcs(args), buildIcs(args));
});
