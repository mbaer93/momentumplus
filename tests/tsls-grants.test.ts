import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planToTier } from "../lib/onboarding";
import {
  activationEmailHtml,
  activationEmailSubject,
} from "../lib/tsls-activation-email";

/*
 * What a TSLS ticket buys, and when it starts (Matt, 2026-08-19):
 * "General Admission gets one month free access to Momentum+ as a Momentum+
 * Member. VIP gets 3 months."
 *
 * Both were 12 until now — introduced in PR #171, contradicting SPEC.md's own
 * tier table, and invisible because a grant eleven months too long looks
 * exactly like a correct one on every screen. The member is simply a member.
 */

test("a General Admission ticket buys one month", () => {
  assert.deepEqual(planToTier("attendee"), { tier: "tsls_attendee", months: 1 });
  assert.deepEqual(planToTier("tslsattendee"), { tier: "tsls_attendee", months: 1 });
  // The sender may space or case it however it likes.
  assert.deepEqual(planToTier(" TSLS Attendee "), { tier: "tsls_attendee", months: 1 });
});

test("a VIP ticket buys three months", () => {
  assert.deepEqual(planToTier("tslsvip"), { tier: "tsls_vip", months: 3 });
  assert.deepEqual(planToTier("TSLS_VIP"), { tier: "tsls_vip", months: 3 });
});

test("SPEC states the same durations the code grants", () => {
  /*
   * The two disagreed for a month and the code won, silently. Whichever is
   * edited next, this fails until the other follows.
   */
  const spec = readFileSync("SPEC.md", "utf8");
  assert.match(spec, /\| tsls_attendee \| Summit General Admission \| 1 month \|/);
  assert.match(spec, /\| tsls_vip \| VIP Summit registration \| 3 months \|/);
});

test("a paid subscription is untouched by the TSLS change", () => {
  // The grant fix must not have reached the plans people actually buy.
  assert.deepEqual(planToTier("monthly"), { tier: "sub_monthly", months: 1 });
  assert.deepEqual(planToTier("3month"), { tier: "sub_3mo", months: 3 });
  assert.deepEqual(planToTier("6month"), { tier: "sub_6mo", months: 6 });
  assert.deepEqual(planToTier("annual"), { tier: "sub_annual", months: 12 });
});

/* --- The reveal ------------------------------------------------------- */

test("the reveal restarts the clock before activating", () => {
  /*
   * Grants are scheduled against the first of the event month, and
   * activateScheduledGift anchors on that date on purpose so a late cron
   * cannot run a gift long. At the reveal that is backwards: a guest
   * activated on the 14th would silently lose the first two weeks of a
   * one-month grant. starts_at must move to now BEFORE activation.
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const update = route.indexOf('.update({ starts_at: nowIso })');
  const activate = route.indexOf("activateScheduledGift(");
  assert.ok(update > 0, "starts_at is never moved — grants would start in the past");
  assert.ok(update < activate, "starts_at must move before activation");
  assert.match(route, /starts_at: nowIso,/, "the activation call must use the new date");
});

test("pressing reveal twice grants and emails nobody twice", () => {
  // Nobody on a stage is sure the first press worked.
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /\.is\("applied_at", null\)/);
  assert.match(route, /applied_at: new Date\(\)\.toISOString\(\)/);
});

test("a failed activation is left for the retry, not stamped", () => {
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  // Just the failure branch — slicing to `activated++` would swallow the
  // success block, whose applied_at stamp is exactly what we're asserting
  // is absent here.
  const start = route.indexOf("if (!res.ok)");
  const fail = route.slice(start, route.indexOf("continue;", start));
  assert.match(fail, /retrying:/);
  assert.doesNotMatch(fail, /applied_at:/, "a failure must not mark the row done");
});

test("the reveal is behind the bridge secret", () => {
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /bridgeAuthorized\(req\)/);
  // 401 before anything is read, let alone activated.
  assert.ok(
    route.indexOf("bridgeAuthorized") < route.indexOf("scheduled_gifts"),
    "authorize before touching data",
  );
});

test("a dry run activates nothing", () => {
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const dry = route.indexOf("if (dryRun)");
  assert.ok(dry > 0, "there is no way to preview the reveal");
  assert.ok(
    dry < route.indexOf('.update({ starts_at: nowIso })'),
    "the dry run must return before any write",
  );
});

/* --- The email -------------------------------------------------------- */

test("the activation email explains itself to someone with no context", () => {
  /*
   * It is the FIRST thing Momentum+ ever sends a TSLS guest — their account
   * was created silently months earlier. It cannot read as a reminder.
   */
  const html = activationEmailHtml({
    name: "Mark",
    tier: "tsls_attendee",
    months: 1,
    loginUrl: "https://momentumplus.co/auth/confirm?token_hash=abc",
  });
  assert.match(html, /1 month/);
  assert.match(html, /Tri-State Leadership Summit/);
  assert.match(html, /already paid for/);
  // They have no password — the link must not talk about logging in with one.
  assert.match(html, /choose a password/);
  assert.match(html, /token_hash=abc/);
  assert.ok(activationEmailSubject().length > 0);
});

test("VIP is told it is three months and worth more", () => {
  const html = activationEmailHtml({ name: "Rob", tier: "tsls_vip", months: 3 });
  assert.match(html, /3 months/);
  assert.match(html, /\$534/);
  const ga = activationEmailHtml({ name: "Rob", tier: "tsls_attendee", months: 1 });
  assert.match(ga, /\$198/);
});

test("a member with no name still gets a sane greeting", () => {
  // TSLS sends what it has; a blank name must not produce "Hi ,".
  const html = activationEmailHtml({ name: "", tier: "tsls_attendee", months: 1 });
  assert.doesNotMatch(html, /Hi\s*,/);
});
