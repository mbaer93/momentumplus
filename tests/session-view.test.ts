import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
};

const START = new Date(base.startsAt).getTime();

test("join window opens 30 minutes before start and closes at end", () => {
  assert.equal(isJoinWindowOpen(base, START - 31 * 60 * 1000), false);
  assert.equal(isJoinWindowOpen(base, START - 30 * 60 * 1000), true);
  assert.equal(isJoinWindowOpen(base, START), true);
  assert.equal(isJoinWindowOpen(base, START + 90 * 60 * 1000), true); // exactly at end
  assert.equal(isJoinWindowOpen(base, START + 91 * 60 * 1000), false);
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

test("durationLabel formats minutes and hours", () => {
  assert.equal(durationLabel(45), "45 min");
  assert.equal(durationLabel(60), "1 hour");
  assert.equal(durationLabel(180), "3 hours");
  assert.equal(durationLabel(90), "90 min");
});
