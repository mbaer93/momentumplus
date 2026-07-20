import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inNextSeason,
  nextOctoberFirst,
  seasonEnd,
  speakerLive,
  sponsorActive,
  sponsorLive,
  upcomingSeasonStart,
} from "../lib/sponsor-lifecycle";

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


test("speakers and sponsors stay hidden until October 1 of the joining year", () => {
  // Joined July 2026 → term ends Oct 1 2027 → season starts Oct 1 2026.
  const row = { archivedAt: null, expiresAt: "2027-10-01T04:00:00.000Z" };
  for (const live of [speakerLive, sponsorLive]) {
    assert.equal(live(row, new Date("2026-07-20T12:00:00Z")), false); // prep
    assert.equal(live(row, new Date("2026-10-01T04:00:00Z")), true); // season opens
    assert.equal(live(row, new Date("2027-06-15T12:00:00Z")), true); // mid-season
    assert.equal(live(row, new Date("2027-10-01T04:00:00Z")), false); // term over
    assert.equal(
      live({ ...row, archivedAt: "2026-11-01T00:00:00Z" }, new Date("2027-06-15T12:00:00Z")),
      false, // archived mid-season
    );
    // Legacy rows without a term stay visible.
    assert.equal(live({ archivedAt: null, expiresAt: null }, new Date("2026-07-20T12:00:00Z")), true);
  }
});

test("upcomingSeasonStart / inNextSeason pick out the pre-season cohort", () => {
  const july = new Date("2026-07-20T12:00:00Z");
  assert.equal(upcomingSeasonStart(july).toISOString(), "2026-10-01T04:00:00.000Z");
  // ET still Sep 30 when UTC is already Oct 1 early morning.
  assert.equal(
    upcomingSeasonStart(new Date("2026-10-01T03:30:00Z")).toISOString(),
    "2026-10-01T04:00:00.000Z",
  );
  assert.equal(
    upcomingSeasonStart(new Date("2026-11-02T12:00:00Z")).toISOString(),
    "2027-10-01T04:00:00.000Z",
  );
  // New joiner (term through Oct 2027) is next season; a current-season
  // supporter (term ends this Oct 1) is not.
  assert.equal(
    inNextSeason({ archivedAt: null, expiresAt: "2027-10-01T04:00:00.000Z" }, july),
    true,
  );
  assert.equal(
    inNextSeason({ archivedAt: null, expiresAt: "2026-10-01T04:00:00.000Z" }, july),
    false,
  );
  assert.equal(
    inNextSeason(
      { archivedAt: "2026-07-01T00:00:00Z", expiresAt: "2027-10-01T04:00:00.000Z" },
      july,
    ),
    false,
  );
  // Ongoing supporters (no end date) belong to every season.
  assert.equal(inNextSeason({ archivedAt: null, expiresAt: null }, july), true);
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
