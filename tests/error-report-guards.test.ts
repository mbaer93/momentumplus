import test from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_THROTTLE_MS,
  PUBLIC_REPORT_PATHS,
  anonymousBucket,
  errorFingerprint,
  throttleExpired,
} from "../lib/error-report-guards";

/*
 * The guards on /api/errors (Phase 8).
 *
 * The endpoint is PUBLIC — error boundaries fire for signed-out visitors —
 * so these are the only thing between a bot and Matt's inbox. Every failure
 * they prevent is silent: an inbox storm at 3am, or a table full of forged
 * rows that makes a real error impossible to find.
 */

const NOW = Date.parse("2026-08-19T04:00:00Z");

test("the same error on the same page is one fingerprint", () => {
  const a = errorFingerprint("Cannot read properties of undefined", "/sessions");
  const b = errorFingerprint("Cannot read properties of undefined", "/sessions");
  assert.equal(a, b);
});

test("the same error on a different page is a different one", () => {
  // Otherwise a crash on /join and a crash on /library merge, and the
  // second one is invisible behind the first one's throttle.
  const join = errorFingerprint("Boom", "/join");
  const library = errorFingerprint("Boom", "/library");
  assert.notEqual(join, library);
});

test("fingerprints are short, hex, and fixed width", () => {
  const hash = errorFingerprint("x", "/y");
  assert.equal(hash.length, 32);
  assert.match(hash, /^[0-9a-f]{32}$/);
});

// --- the abuse bound --------------------------------------------------------

test("anonymous reports are only accepted from the payment paths", () => {
  for (const p of PUBLIC_REPORT_PATHS) {
    assert.ok(anonymousBucket(p), `${p} should be reportable`);
  }
  // Everything else from a signed-out visitor is dropped entirely.
  assert.equal(anonymousBucket("/dashboard"), null);
  assert.equal(anonymousBucket("/admin/members"), null);
  assert.equal(anonymousBucket(""), null);
});

test("query strings and sub-paths still match their bucket", () => {
  // /join?plan=annual and /tickets/vip are the same crash as their parent.
  assert.equal(anonymousBucket("/join?plan=annual")?.path, "/join");
  assert.equal(anonymousBucket("/tickets/vip")?.path, "/tickets");
});

test("a lookalike path does not match", () => {
  // "/joinery" must not inherit /join's bucket.
  assert.equal(anonymousBucket("/joinery"), null);
  assert.equal(anonymousBucket("/ticketsomething"), null);
});

test("the anonymous hash ignores the message entirely", () => {
  /*
   * THE abuse bound. If attacker-controlled text reached the fingerprint, a
   * bot could mint unlimited distinct rows; because only the path is
   * hashed, any amount of junk can bump exactly one counter per path.
   */
  const a = anonymousBucket("/join?utm=a");
  const b = anonymousBucket("/join?utm=b");
  assert.equal(a?.hash, b?.hash);

  // And an anonymous bucket is never the same row as a signed-in report on
  // the same path — a visitor's crash cannot overwrite a member's.
  assert.notEqual(a?.hash, errorFingerprint("anything", "/join"));
});

// --- the throttle -----------------------------------------------------------

test("never emailed means email now", () => {
  assert.equal(throttleExpired(null, NOW), true);
  assert.equal(throttleExpired(undefined, NOW), true);
});

test("inside the window stays quiet, outside it sends", () => {
  const justInside = new Date(NOW - EMAIL_THROTTLE_MS + 1000).toISOString();
  const justOutside = new Date(NOW - EMAIL_THROTTLE_MS - 1000).toISOString();
  assert.equal(throttleExpired(justInside, NOW), false);
  assert.equal(throttleExpired(justOutside, NOW), true);
  // Exactly at the boundary sends — a window that never quite expires is
  // how an alert stops arriving at all.
  assert.equal(throttleExpired(new Date(NOW - EMAIL_THROTTLE_MS).toISOString(), NOW), true);
});

test("an unreadable timestamp fails CLOSED, not open", () => {
  /*
   * The dangerous direction. Treating garbage as "never emailed" would turn
   * one malformed row into an alert on every single report — the exact
   * inbox storm the throttle exists to prevent.
   */
  assert.equal(throttleExpired("not-a-date", NOW), false);
  assert.equal(throttleExpired("", NOW), true); // empty = absent, which is fine
});
