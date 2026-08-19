import test from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_TRACKS,
  foundingCohort,
  PAID_TIERS,
  wasBought,
  OVERALL_LEVELS,
  badgeKeyLabel,
  badgesFrom,
  earnedBadgeKeys,
  levelBadgeKey,
  milestoneBadgeKey,
  selectableBadges,
  trackBadgeKey,
  earnedTracks,
  levelForPoints,
  nextThreshold,
  tierFor,
  unitLabel,
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

test("units read correctly at one", () => {
  // "1 courses" shipped to a screenshot before this test existed.
  assert.equal(unitLabel("courses", 1), "course");
  assert.equal(unitLabel("courses", 6), "courses");
  assert.equal(unitLabel("months", 1), "month");
  // Noun phrases singularise only their head word — "1 session with note"
  // would be a worse bug than the one being fixed.
  assert.equal(unitLabel("sessions with notes", 1), "session with notes");
  assert.equal(unitLabel("episodes", 0), "episodes");
});

/*
 * Badge KEYS (migration 0091). These strings are written to the database,
 * pushed to GHL as contact tags, and stored in the audience of announcements
 * that have already been sent — so a change to one silently re-targets past
 * and future sends. Treated as an interface, not a label.
 */

test("badge keys are stable and namespaced", () => {
  assert.equal(trackBadgeKey("attendance", "gold"), "attendance:gold");
  assert.equal(milestoneBadgeKey("founding"), "milestone:founding");
  assert.equal(levelBadgeKey("committed"), "level:committed");
});

test("earning a tier also earns the tiers below it", () => {
  // "Everyone who has reached In the Room, any tier" has to be one
  // `badge_key in (...)`, not a tier comparison at every call site.
  const keys = earnedBadgeKeys({ ...base, attendance: 10 });
  assert.ok(keys.includes("attendance:bronze"));
  assert.ok(keys.includes("attendance:silver"));
  assert.ok(keys.includes("attendance:gold"));
});

test("an unearned track produces no keys at all", () => {
  const keys = earnedBadgeKeys({ ...base, attendance: 0 });
  assert.ok(!keys.some((k) => k.startsWith("attendance:")));
});

test("a null count never earns a key", () => {
  // Community is unmeasured until Stream is wired. Awarding its bottom tier
  // to everyone would put a badge on people who have never posted.
  const keys = earnedBadgeKeys({ ...base, community: null });
  assert.ok(!keys.some((k) => k.startsWith("community:")));
});

test("milestones map to their own namespace", () => {
  const keys = earnedBadgeKeys({
    ...base,
    summitAttendee: true,
    foundingMember: true,
    courses: 1,
  });
  assert.ok(keys.includes("milestone:summit"));
  assert.ok(keys.includes("milestone:founding"));
  assert.ok(keys.includes("milestone:certified"));
});

test("levels below the one reached are earned too, but never 'start'", () => {
  // Gold attendance + gold podcast = 6 points, which clears Engaged (3) but
  // not Committed (7).
  const keys = earnedBadgeKeys({ ...base, attendance: 10, podcast: 30 });
  assert.ok(keys.includes("level:engaged"));
  assert.ok(!keys.includes("level:committed"));
  // "Getting Started" is the absence of a badge, not a badge.
  assert.ok(!keys.includes("level:start"));
});

test("the ledger raises a badge but never lowers one", () => {
  /*
   * Matt's rule: earned is earned. Archive the sessions behind someone's
   * Gold and their live count collapses — the badge they were shown, and may
   * have been given a deal for, must survive our own content edit.
   */
  const collapsed: BadgeCounts = { ...base, attendance: 0 };
  const ever = new Set(["attendance:bronze", "attendance:silver", "attendance:gold"]);
  const held = badgesFrom(collapsed, { everEarned: ever });
  assert.equal(held.tracks.find((t) => t.key === "attendance")?.tier, "gold");

  // And it cannot pull a real Gold down to a stale Bronze.
  const live = badgesFrom(
    { ...base, attendance: 10 },
    { everEarned: new Set(["attendance:bronze"]) },
  );
  assert.equal(live.tracks.find((t) => t.key === "attendance")?.tier, "gold");
});

test("a milestone in the ledger survives losing its underlying count", () => {
  const held = badgesFrom(base, {
    everEarned: new Set(["milestone:founding"]),
  });
  assert.ok(held.milestones.some((m) => m.key === "founding"));
});

test("every selectable badge has a label that isn't its key", () => {
  // The picker and the GHL tag names both read from this; a key leaking
  // through as a label is how "attendance:gold" ends up in an email.
  for (const b of selectableBadges()) {
    assert.notEqual(b.label, b.key);
    assert.ok(b.label.length > 0);
    // badgeKeyLabel qualifies levels ("Engaged (level)") because it is read
    // out of context, in an audience list; the picker shows them grouped.
    assert.ok(badgeKeyLabel(b.key).startsWith(b.label));
  }
});

test("a measured community count of zero SHOWS the track", () => {
  /*
   * The mirror of the null case, and the whole point of migration 0094:
   * null means "we cannot count this" and hides the track, 0 means "you
   * have not posted yet" and shows what the first badge would take. Collapse
   * the two and the track either lies or vanishes.
   */
  const badges = badgesFrom({ ...base, community: 0 });
  const track = badges.tracks.find((t) => t.key === "community");
  assert.ok(track, "a counted-but-quiet member should see the track");
  assert.equal(track?.count, 0);
  assert.equal(track?.nextAt, BADGE_TRACKS.find((t) => t.key === "community")?.thresholds[0]);
  // Still unearned, so it awards no key.
  assert.ok(!earnedBadgeKeys({ ...base, community: 0 }).some((k) => k.startsWith("community:")));
});

/*
 * Who counts as having BOUGHT something (Founding Member).
 *
 * Nearly cost a paying member their badge: the Stripe webhook's
 * missed-checkout heal writes the membership as `basic`/`pro` — the member
 * LEVEL — rather than the plan bought, so a real customer with a receipt
 * would have been read as a comp.
 */

test("the four sold plans count however they were recorded", () => {
  for (const tier of PAID_TIERS) {
    assert.ok(wasBought(tier, "stripe"));
    // Source-independent: a plan tier is only ever written by a purchase.
    assert.ok(wasBought(tier, "admin"));
    assert.ok(wasBought(tier, null));
  }
});

test("a member level counts only when it came from a payment", () => {
  // The healed-checkout case: real money, recorded as a level.
  assert.ok(wasBought("basic", "stripe"));
  assert.ok(wasBought("pro", "ghl"));
  // The comp case: same tier, granted by hand.
  assert.ok(!wasBought("basic", "admin"));
  assert.ok(!wasBought("pro", "zapier"));
  assert.ok(!wasBought("basic", "tsls_import"));
  assert.ok(!wasBought("basic", null));
});

test("granted tiers never count, whatever the source says", () => {
  // A summit ticket, a gift, and a comped speaker are not purchases of this.
  for (const tier of ["gift", "vip", "tsls_attendee", "tsls_vip", "speaker", "sponsor", "admin"]) {
    assert.ok(!wasBought(tier, "stripe"), `${tier} must not read as bought`);
    assert.ok(!wasBought(tier, "ghl"), `${tier} must not read as bought`);
  }
});

/*
 * The founding cohort: first 100, or October 1 2027, whichever comes first
 * (Matt, 2026-08-19).
 *
 * The cap makes this the only badge that cannot be decided from one
 * member's own rows — whether you are the hundredth or the hundred-and-
 * first depends on people you have never met. It is also permanent once
 * awarded, so an over-award cannot be taken back.
 */

const at = (iso: string, id: string) => ({ profileId: id, paidAt: iso });

test("everyone inside the window qualifies while there is room", () => {
  const cohort = foundingCohort([
    at("2026-10-14T00:00:00Z", "a"),
    at("2027-05-01T00:00:00Z", "b"),
    at("2027-10-01T23:59:59Z", "c"),
  ]);
  assert.deepEqual([...cohort].sort(), ["a", "b", "c"]);
});

test("the window is closed at both ends", () => {
  const cohort = foundingCohort([
    at("2026-10-13T23:59:59Z", "early"), // the day before go-live
    at("2027-10-02T00:00:00Z", "late"), // the day after it closes
    at("2026-10-14T00:00:00Z", "first"),
  ]);
  assert.deepEqual([...cohort], ["first"]);
});

test("the cap takes the EARLIEST hundred, not the first hundred seen", () => {
  // Rows arrive in whatever order the database returns them; the cohort is
  // the people who paid first, not the people who were read first.
  const late = Array.from({ length: 100 }, (_, i) =>
    at("2027-01-01T00:00:00Z", `late-${i}`),
  );
  const early = at("2026-10-14T00:00:00Z", "early-bird");
  const cohort = foundingCohort([...late, early], { cap: 100 });
  assert.ok(cohort.has("early-bird"));
  assert.equal(cohort.size, 100);
});

test("the hundred-and-first misses out", () => {
  const many = Array.from({ length: 101 }, (_, i) =>
    // Ascending by minute, so the order is unambiguous.
    at(new Date(Date.parse("2026-10-14T00:00:00Z") + i * 60_000).toISOString(), `m${i}`),
  );
  const cohort = foundingCohort(many, { cap: 100 });
  assert.equal(cohort.size, 100);
  assert.ok(cohort.has("m0"));
  assert.ok(!cohort.has("m100"));
});

test("a member is ranked by their FIRST payment, and counted once", () => {
  // Renewals must not push someone down the order, and must not consume two
  // of the hundred slots.
  const cohort = foundingCohort(
    [
      at("2026-10-14T00:00:00Z", "renewer"),
      at("2027-01-01T00:00:00Z", "renewer"),
      at("2026-10-15T00:00:00Z", "other"),
    ],
    { cap: 2 },
  );
  assert.deepEqual([...cohort].sort(), ["other", "renewer"]);
});

test("a tie breaks the same way every run", () => {
  /*
   * Two people paying in the same second is not hypothetical at launch. If
   * the tiebreak were the database's row order, the hundredth member would
   * be whoever was returned first tonight — and could differ tomorrow, on
   * a badge that is permanent once awarded.
   */
  const same = "2026-10-14T09:00:00Z";
  const a = foundingCohort([at(same, "zzz"), at(same, "aaa")], { cap: 1 });
  const b = foundingCohort([at(same, "aaa"), at(same, "zzz")], { cap: 1 });
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([...a], ["aaa"]);
});

test("junk rows cannot take a slot", () => {
  const cohort = foundingCohort(
    [
      { profileId: "", paidAt: "2026-10-14T00:00:00Z" },
      { profileId: "real", paidAt: "" },
      at("2026-10-14T00:00:00Z", "genuine"),
    ],
    { cap: 100 },
  );
  assert.deepEqual([...cohort], ["genuine"]);
});

test("an empty population is an empty cohort, not everyone", () => {
  assert.equal(foundingCohort([]).size, 0);
});

test("the same instant qualifies however it is spelled", () => {
  /*
   * Caught by the test above before this rule ever shipped. These are all
   * go-live exactly, and string comparison ranks two of them OUTSIDE the
   * window — "." sorts under "Z", so "…T00:00:00.000Z" reads as earlier
   * than "…T00:00:00Z". Postgres returns the offset form, so the member who
   * paid at the stroke of launch is precisely who would have lost the badge.
   */
  for (const spelling of [
    "2026-10-14T00:00:00Z",
    "2026-10-14T00:00:00.000Z",
    "2026-10-14T00:00:00+00:00",
    "2026-10-13T20:00:00-04:00", // the same instant, Eastern
  ]) {
    const cohort = foundingCohort([at(spelling, "paid-at-launch")]);
    assert.equal(cohort.size, 1, `${spelling} should qualify`);
  }
  // And the instant before go-live still does not, in any spelling.
  assert.equal(foundingCohort([at("2026-10-13T23:59:59.999Z", "early")]).size, 0);
});
