import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDE_GROUPS,
  GUIDE_STEPS,
  currentStep,
  groupProgress,
  stepDone,
  type GuideFacts,
} from "../lib/guide-steps";

/*
 * The Momentum+ guide (Matt, 2026-08-18).
 *
 * The thing that matters here is honesty about progress: a step that ticks
 * itself before the member did it teaches them the checklist is decoration,
 * and one that refuses to tick after they DID it is worse.
 */

const nothing: GuideFacts = {
  enrolled: false,
  prefsSaved: false,
  profileFilled: false,
  attended: false,
  wroteNote: false,
  heardEpisode: false,
  finishedCourse: false,
};

test("every step belongs to a real group", () => {
  const keys = new Set(GUIDE_GROUPS.map((g) => g.key));
  for (const s of GUIDE_STEPS) {
    assert.ok(keys.has(s.group), `${s.key} has no group`);
  }
});

test("step keys are unique", () => {
  // Duplicates would share a localStorage entry and tick each other off.
  const keys = GUIDE_STEPS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("every step goes somewhere in the portal", () => {
  for (const s of GUIDE_STEPS) {
    assert.ok(s.href.startsWith("/"), `${s.key} href must be a portal path`);
    assert.ok(s.cta.trim().length > 0, `${s.key} needs a button label`);
  }
});

test("a fresh member has done nothing and starts at step one", () => {
  const visited = new Set<string>();
  assert.equal(
    GUIDE_STEPS.filter((s) => stepDone(s, nothing, visited)).length,
    0,
  );
  assert.equal(currentStep(nothing, visited)?.key, GUIDE_STEPS[0].key);
});

test("server truth ticks a step without the member visiting it", () => {
  // Someone who enrolled months before the guide existed must not be told
  // to go and enroll.
  const visited = new Set<string>();
  const facts = { ...nothing, enrolled: true };
  const enroll = GUIDE_STEPS.find((s) => s.key === "enroll")!;
  assert.equal(stepDone(enroll, facts, visited), true);
  assert.notEqual(currentStep(facts, visited)?.key, "enroll");
});

test("visiting ticks the steps the server cannot see", () => {
  const step = GUIDE_STEPS.find((s) => s.verifiedBy === null)!;
  assert.equal(stepDone(step, nothing, new Set()), false);
  assert.equal(stepDone(step, nothing, new Set([step.key])), true);
});

test("group progress counts only that group", () => {
  const facts = { ...nothing, enrolled: true };
  const setup = groupProgress("setup", facts, new Set());
  assert.equal(setup.done, 1);
  assert.equal(setup.total, GUIDE_STEPS.filter((s) => s.group === "setup").length);
  assert.equal(groupProgress("deeper", facts, new Set()).done, 0);
});

test("the guide disappears only when everything is done", () => {
  const visited = new Set(GUIDE_STEPS.map((s) => s.key));
  assert.equal(currentStep(nothing, visited), null);

  // One short: still showing, and pointing at the one that is left.
  const missing = new Set(visited);
  missing.delete("resources");
  assert.equal(currentStep(nothing, missing)?.key, "resources");
});
