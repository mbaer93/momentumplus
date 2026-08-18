import test from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_TRACKS,
  OVERALL_LEVELS,
  badgesFrom,
  earnedTracks,
  levelForPoints,
  nextThreshold,
  tierFor,
  type BadgeCounts,
} from "../lib/badges";

/*
 * Engagement badges (Matt, 2026-08-18).
 *
 * These decide what is shown next to a member's name in the directory and on
 * their chat messages, so the failure modes are social, not technical: a
 * badge awarded too easily is meaningless, one awarded to the wrong person
 * is embarrassing, and one shown for someone who asked us to hide it is a
 * broken promise.
 */

const base: BadgeCounts = {
  attendance: 0,
  notes: 0,
  courses: 0,
  podcast: 0,
  community: null,
  tenure: 0,
  summitAttendee: false,
  foundingMember: false,
};

test("thresholds are ascending on every track", () => {
  // A descending pair would silently make the middle tier unreachable.
  for (const t of BADGE_TRACKS) {
    assert.ok(
      t.thresholds[0] < t.thresholds[1] && t.thresholds[1] < t.thresholds[2],
      `${t.key} thresholds must ascend: ${t.thresholds.join(", ")}`,
    );
    assert.ok(t.thresholds[0] > 0, `${t.key} bronze must need more than zero`);
  }
});

test("a tier is earned AT its threshold, not one past it", () => {
  const th: [number, number, number] = [1, 4, 10];
  assert.equal(tierFor(0, th), null);
  assert.equal(tierFor(1, th), "bronze");
  assert.equal(tierFor(3, th), "bronze");
  assert.equal(tierFor(4, th), "silver");
  assert.equal(tierFor(10, th), "gold");
  assert.equal(tierFor(999, th), "gold");
});

test("the next threshold is what's actually next, and null at gold", () => {
  const th: [number, number, number] = [1, 4, 10];
  assert.equal(nextThreshold(0, th), 1);
  assert.equal(nextThreshold(1, th), 4);
  assert.equal(nextThreshold(9, th), 10);
  assert.equal(nextThreshold(10, th), null);
});

test("an unmeasured track awards nothing and is not shown", () => {
  /*
   * Community messages live in Stream, so the count is null until that is
   * wired. Null must not read as zero: zero would award the bottom tier of a
   * track the member may well have earned, and would tell someone who posts
   * daily that they have posted nothing.
   */
  const badges = badgesFrom({ ...base, community: null });
  assert.equal(tierFor(null, [1, 20, 75]), null);
  assert.ok(!badges.tracks.some((t) => t.key === "community"));
});

test("points and level climb with real activity", () => {
  const quiet = badgesFrom({ ...base, attendance: 1 });
  assert.equal(quiet.points, 1);
  assert.equal(quiet.level.label, "Getting Started");

  const busy = badgesFrom({
    ...base,
    attendance: 10, // gold  3
    notes: 5, //      silver 2
    courses: 1, //    bronze 1
    podcast: 12, //   silver 2
    tenure: 24, //    gold   3
  });
  assert.equal(busy.points, 11);
  assert.equal(busy.level.label, "Driving");
});

test("the top level is reachable without every track", () => {
  // Nobody does all six. A level nobody reaches motivates nobody.
  const withoutCommunity = badgesFrom({
    ...base,
    attendance: 10,
    notes: 12,
    courses: 6,
    podcast: 30,
    tenure: 24,
    community: null,
  });
  assert.equal(withoutCommunity.points, 15);
  assert.equal(withoutCommunity.level.label, "All In");
});

test("level bands are ordered and start at zero", () => {
  assert.equal(OVERALL_LEVELS[0].from, 0);
  for (let i = 1; i < OVERALL_LEVELS.length; i++) {
    assert.ok(
      OVERALL_LEVELS[i].from > OVERALL_LEVELS[i - 1].from,
      "level floors must ascend",
    );
  }
  assert.equal(levelForPoints(0).key, "start");
  assert.equal(levelForPoints(18).key, "all_in");
});

test("milestones are earned only when actually earned", () => {
  const none = badgesFrom(base);
  assert.deepEqual(none.milestones, []);

  const some = badgesFrom({
    ...base,
    summitAttendee: true,
    foundingMember: true,
    courses: 1,
  });
  assert.deepEqual(
    some.milestones.map((m) => m.key).sort(),
    ["certified", "founding", "summit"],
  );
});

test("earnedTracks drops the tracks with nothing on them", () => {
  // The profile shows "4 more for Bronze"; the directory shows only what has
  // actually been earned, or every member carries a row of empty badges.
  const badges = badgesFrom({ ...base, attendance: 4, notes: 0 });
  const earned = earnedTracks(badges);
  assert.deepEqual(
    earned.map((t) => t.key),
    ["attendance"],
  );
  assert.equal(earned[0].tier, "silver");
});

test("hidden is carried through, not inferred", () => {
  assert.equal(badgesFrom(base).hidden, false);
  assert.equal(badgesFrom(base, { hidden: true }).hidden, true);
});
