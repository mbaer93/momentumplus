import { test } from "node:test";
import assert from "node:assert/strict";
import { grantsMoreContent, type ContentAccess } from "../lib/tiers-shared";

/*
 * grantsMoreContent decides whether a checkout by a member with unexpired
 * comped access bills immediately (real content upgrade) or waits for the
 * comped access to run out (sideways move). The fixtures mirror the seeded
 * registry rows in migration 0054.
 */

const t = (
  libraryScope: string,
  clearsProOnly = false,
  clearsVipPlus = false,
): ContentAccess => ({ libraryScope, clearsProOnly, clearsVipPlus });

const member = t("current_season");
const pro = t("all_seasons", true, true);
const lite = t("none");
const vip = t("current_season"); // comped: vip, gift, tsls_attendee

test("sideways move: comped current-season member buying Member is not more content", () => {
  assert.equal(grantsMoreContent(member, vip), false);
});

test("upgrade: comped current-season member buying Pro is more content", () => {
  assert.equal(grantsMoreContent(pro, vip), true);
});

test("upgrade: Lite buying Member opens the Library", () => {
  assert.equal(grantsMoreContent(member, lite), true);
});

test("clears flags alone count as more content at equal scope", () => {
  const exclusiveOnly = t("current_season", false, true);
  assert.equal(grantsMoreContent(exclusiveOnly, member), true);
});

test("downgrade or equal is never more content", () => {
  assert.equal(grantsMoreContent(member, pro), false);
  assert.equal(grantsMoreContent(pro, pro), false);
});

test("unknown scope slugs degrade to no extra content, not a crash", () => {
  assert.equal(grantsMoreContent(t("mystery"), member), false);
});
