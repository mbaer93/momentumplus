import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOctoberFirst, sponsorActive } from "../lib/sponsor-lifecycle";

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
