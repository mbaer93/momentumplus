import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canEnroll,
  displayStatus,
  isJoinWindowOpen,
  isLive,
  durationLabel,
} from "../lib/sessions/view";

const base = {
  startsAt: "2026-02-18T16:00:00.000Z",
  durationMin: 90,
  isEnrolled: true,
  attended: false,
  status: "scheduled" as const,
};

const START = new Date(base.startsAt).getTime();

test("join window opens 30 minutes before start and allows a 60-minute overrun", () => {
  assert.equal(isJoinWindowOpen(base, START - 31 * 60 * 1000), false);
  assert.equal(isJoinWindowOpen(base, START - 30 * 60 * 1000), true);
  assert.equal(isJoinWindowOpen(base, START), true);
  assert.equal(isJoinWindowOpen(base, START + 90 * 60 * 1000), true); // exactly at end
  // Sessions run long — the room stays joinable through a 60-minute overrun.
  assert.equal(isJoinWindowOpen(base, START + 150 * 60 * 1000), true); // end + 60min
  assert.equal(isJoinWindowOpen(base, START + 151 * 60 * 1000), false);
});

test("isLive is true only between start and end", () => {
  assert.equal(isLive(base, START - 1), false);
  assert.equal(isLive(base, START + 1), true);
  assert.equal(isLive(base, START + 90 * 60 * 1000 + 1), false);
});

test("displayStatus reflects live/upcoming/enrolled/attended/past", () => {
  assert.equal(displayStatus(base, START + 10 * 60 * 1000), "live");
  assert.equal(
    displayStatus({ ...base, isEnrolled: true }, START - 2 * 24 * 3600 * 1000),
    "enrolled",
  );
  assert.equal(
    displayStatus({ ...base, isEnrolled: false }, START - 2 * 24 * 3600 * 1000),
    "upcoming",
  );
  assert.equal(
    displayStatus(
      { ...base, attended: true },
      START + 5 * 24 * 3600 * 1000,
    ),
    "attended",
  );
  assert.equal(
    displayStatus(
      { ...base, attended: false },
      START + 5 * 24 * 3600 * 1000,
    ),
    "past",
  );
});

test("DB status overrides the clock: cancelled/draft/completed win", () => {
  const before = START - 2 * 24 * 3600 * 1000;
  assert.equal(
    displayStatus({ ...base, status: "cancelled" as const }, before),
    "cancelled",
  );
  assert.equal(
    displayStatus({ ...base, status: "draft" as const }, before),
    "draft",
  );
  // Future-dated but marked completed must NOT render as upcoming.
  assert.equal(
    displayStatus({ ...base, status: "completed" as const, isEnrolled: false }, before),
    "past",
  );
});

test("canEnroll blocks cancelled, past, and full sessions", () => {
  const before = START - 24 * 3600 * 1000;
  const open = { ...base, isEnrolled: false, capacity: 20, enrolledCount: 5 };
  assert.deepEqual(canEnroll(open, before), { ok: true, reason: null });
  assert.deepEqual(
    canEnroll({ ...open, status: "cancelled" as const }, before),
    { ok: false, reason: "cancelled" },
  );
  assert.deepEqual(
    canEnroll(open, START + 91 * 60 * 1000),
    { ok: false, reason: "past" },
  );
  assert.deepEqual(
    canEnroll({ ...open, enrolledCount: 20 }, before),
    { ok: false, reason: "full" },
  );
  // Already-enrolled members aren't blocked by fullness (they can cancel).
  assert.deepEqual(
    canEnroll({ ...open, isEnrolled: true, enrolledCount: 20 }, before),
    { ok: true, reason: null },
  );
  // No capacity = never full.
  assert.deepEqual(
    canEnroll({ ...open, capacity: null, enrolledCount: 500 }, before),
    { ok: true, reason: null },
  );
});

test("durationLabel formats minutes and hours", () => {
  assert.equal(durationLabel(45), "45 min");
  assert.equal(durationLabel(60), "1 hour");
  assert.equal(durationLabel(180), "3 hours");
  assert.equal(durationLabel(90), "90 min");
});
