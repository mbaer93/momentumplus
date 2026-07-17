import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOctoberFirst, seasonEnd, sponsorActive } from "../lib/sponsor-lifecycle";

test("nextOctoberFirst rolls to this year's Oct 1 before it, next year's after", () => {
  const july = new Date("2026-07-17T12:00:00Z");
  assert.equal(nextOctoberFirst(july).toISOString(), "2026-10-01T04:00:00.000Z");
  const november = new Date("2026-11-02T12:00:00Z");
  assert.equal(
    nextOctoberFirst(november).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
  // Exactly at the boundary → next year (current term just ended).
  const boundary = new Date("2026-10-01T04:00:00.000Z");
  assert.equal(
    nextOctoberFirst(boundary).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
});

test("sponsorActive hides archived and expired sponsors", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  assert.equal(sponsorActive({ archivedAt: null, expiresAt: null }, now), true);
  assert.equal(
    sponsorActive({ archivedAt: null, expiresAt: "2026-10-01T04:00:00Z" }, now),
    true,
  );
  assert.equal(
    sponsorActive({ archivedAt: null, expiresAt: "2026-07-01T04:00:00Z" }, now),
    false,
  );
  assert.equal(
    sponsorActive({ archivedAt: "2026-07-01T00:00:00Z", expiresAt: null }, now),
    false,
  );
});


test("seasonEnd is always Oct 1 of the year after joining (ET)", () => {
  assert.equal(
    seasonEnd(new Date("2026-07-17T12:00:00Z")).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
  assert.equal(
    seasonEnd(new Date("2026-11-15T12:00:00Z")).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
  // Dec 31 ET vs UTC edge: 2026-12-31 23:30 ET is 2027-01-01 04:30 UTC —
  // the ET year (2026) governs.
  assert.equal(
    seasonEnd(new Date("2027-01-01T04:30:00Z")).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
});
