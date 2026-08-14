import test from "node:test";
import assert from "node:assert/strict";
import { seesLaunchedApp } from "../lib/testers";
import { tierHasFeature } from "../lib/tiers";
import type { AccessMatrix } from "../lib/tiers";

/*
 * Testers and the October 14 rehearsal (Matt, 2026-08-14).
 *
 * Two properties matter more than the plumbing:
 *
 *   1. A tester rehearses THEIR OWN TIER. If the rehearsal handed testers
 *      everything, they'd sign off on an app no member will ever see.
 *   2. Real members are untouched, switch on or off. The rehearsal exists so
 *      that unlaunched work can be exercised in production — leaking it to
 *      members is the one outcome that cannot be undone.
 */

const matrix = {
  tiers: [],
  features: [
    { key: "library", label: "Library", description: "", navHref: null, sort: 1, isLaunched: true },
    { key: "courses", label: "Courses", description: "", navHref: null, sort: 2, isLaunched: false },
  ],
  grants: {
    basic: { library: true, courses: false },
    pro: { library: true, courses: true },
  },
} as unknown as AccessMatrix;

test("an unlaunched feature stays shut for a real member", () => {
  assert.equal(tierHasFeature(matrix, "pro", "courses"), false);
});

test("a tester in the rehearsal reaches an unlaunched feature their tier grants", () => {
  assert.equal(
    tierHasFeature(matrix, "pro", "courses", { launchedForViewer: true }),
    true,
  );
});

test("the rehearsal does NOT hand a tester another tier's features", () => {
  // The whole value of the rehearsal is that it is faithful. A Member-tier
  // tester who can open Pro-only courses is testing a product that will
  // never exist.
  assert.equal(
    tierHasFeature(matrix, "basic", "courses", { launchedForViewer: true }),
    false,
  );
});

test("a launched feature is unaffected by the rehearsal either way", () => {
  assert.equal(tierHasFeature(matrix, "basic", "library"), true);
  assert.equal(
    tierHasFeature(matrix, "basic", "library", { launchedForViewer: true }),
    true,
  );
});

test("who sees the launched app", () => {
  const on = { rehearsalOn: true };
  const off = { rehearsalOn: false };
  // Admins always — previewing the launch is how it gets checked.
  assert.equal(seesLaunchedApp({ isAdmin: true, isTester: false, ...off }), true);
  // Testers only once the switch is on.
  assert.equal(seesLaunchedApp({ isAdmin: false, isTester: true, ...off }), false);
  assert.equal(seesLaunchedApp({ isAdmin: false, isTester: true, ...on }), true);
  // A real member: never, switch or no switch. This is the leak that must
  // not happen.
  assert.equal(seesLaunchedApp({ isAdmin: false, isTester: false, ...on }), false);
});
