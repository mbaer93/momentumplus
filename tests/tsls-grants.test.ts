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

/* --- The reveal's blast radius (TSLS security review, 2026-08-19) ------ */

test("a real activation will not accept the provisioning key", () => {
  /*
   * The finding, in their framing: provisioning key + no scoping + no
   * inbound ceiling + irreversible reveal is ONE compound risk, not four.
   * The provisioning key lives in a sync loop that runs all day; the reveal
   * key is used once, ever. Sharing them means a single leaked env var can
   * activate every grant and email every guest at the wrong moment, and
   * neither of those is recoverable.
   *
   * So there is deliberately no fallback to bridgeAuthorized on the real
   * path. A fallback would be the shared-key problem with extra steps.
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  // Search for the end marker AFTER the else, or indexOf finds the import
  // line and the slice comes back empty — which would pass vacuously.
  const elseAt = route.indexOf("} else {");
  const realPath = route.slice(elseAt, route.indexOf("isSupabaseConfigured", elseAt));
  assert.ok(realPath.length > 50, "sliced the wrong region — the test proves nothing");
  assert.match(realPath, /revealAuthorized\(req\)/);
  assert.doesNotMatch(
    realPath,
    /bridgeAuthorized/,
    "the provisioning key must not open a real activation",
  );
});

test("a dry run still works with either key", () => {
  // TSLS has to verify its wiring and read the count without being handed
  // the once-ever secret — which is the entire reason the keys are split.
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const dryPath = route.slice(route.indexOf("if (dryRun) {"), route.indexOf("} else {"));
  assert.match(dryPath, /bridgeAuthorized\(req\)/);
  assert.match(dryPath, /revealAuthorized\(req\)/);
});

test("an unset reveal key reads differently from a wrong one", () => {
  // At 9am on event day, "you sent the wrong secret" and "nobody ever set
  // this up" need different people doing different things.
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /revealKeyConfigured\(\)/);
  assert.match(route, /status: 503/);
  assert.match(route, /MOMENTUM_REVEAL_KEY is not set/);
});

test("the reveal key never falls back to another secret", () => {
  const auth = readFileSync("lib/bridge-auth.ts", "utf8");
  const fn = auth.slice(auth.indexOf("export function revealAuthorized"));
  assert.match(fn, /\[process\.env\.MOMENTUM_REVEAL_KEY\]/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("}")), /MOMENTUM_BRIDGE_KEY|ZAPIER/);
});

test("an unset secret can never match an empty key", () => {
  // matchesAny skips undefined secrets. Without that, a deployment missing
  // MOMENTUM_REVEAL_KEY would authorize a request that sent no key at all.
  const auth = readFileSync("lib/bridge-auth.ts", "utf8");
  assert.match(auth, /if \(!secret\) continue;/);
  assert.match(auth, /timingSafeEqual/);
});

/* --- Rehearsing the reveal on one person (Matt, 2026-08-20) ----------- */

test("the clock update is scoped exactly like the read", () => {
  /*
   * The failure this prevents is silent and expensive. If the bulk
   * starts_at update were wider than the row read, rehearsing on one
   * person would move all 74 guests' start dates to today while activating
   * only one — shortening everybody's free month by however long remained,
   * with no error and nothing to see. Read, count and update must all go
   * through the same scoping helper.
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const update = route.slice(route.indexOf('.update({ starts_at: nowIso })') - 200);
  assert.match(
    update.slice(0, 260),
    /scoped\(/,
    "the starts_at update is not scoped — a rehearsal would move everyone's clock",
  );
  // Three call sites: read, count, update. Fewer means one was missed.
  assert.ok(
    (route.match(/scoped\(/g) ?? []).length >= 3,
    "expected the read, the count and the clock update to all be scoped",
  );
});

test("a rehearsal says so in the response, on both paths", () => {
  /*
   * `remaining` is scoped too, so a rehearsal reports 0 — true for that one
   * person and dangerously misleading on its own, because TSLS reads
   * `remaining` to decide whether to press again. onlyEmail beside it is
   * what stops "remaining: 0" being read as "everyone is done".
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /rehearsal: true/);
  assert.ok(
    (route.match(/onlyEmail: redactEmail\(onlyEmail\)/g) ?? []).length >= 2,
    "both the dry-run and the real response must name the scope",
  );
});

test("the email is never echoed raw", () => {
  // Same rule as every other response on this route: it is a log line
  // somewhere, not a support ticket.
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.doesNotMatch(route, /onlyEmail: onlyEmail\b/);
  assert.doesNotMatch(route, /onlyEmail,\s*$/m);
});

test("scoping narrows and never widens", () => {
  /*
   * onlyEmail changes WHICH parked rows are touched, never the guards. Same
   * key, same ceiling, same idempotency — so a rehearsal cannot reach an
   * already-activated row, and cannot be used to skip the reveal secret.
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const beforeScope = route.slice(0, route.indexOf("const scoped ="));
  assert.match(beforeScope, /revealAuthorized\(req\)/, "auth must precede scoping");
  assert.match(beforeScope, /rateLimited\("bridge\/reveal"\)/, "ceiling must precede scoping");
  // applied_at is still the idempotency key on every scoped query.
  assert.ok(
    (route.match(/\.is\("applied_at", null\)/g) ?? []).length >= 3,
    "a scoped query dropped the applied_at guard",
  );
});

test("a blank or non-string onlyEmail means everyone, not nobody", () => {
  /*
   * The on-stage call sends {} or omits the field. If an empty string
   * scoped the query to email = "", the reveal would activate nobody and
   * report success — the worst possible failure, at the worst moment.
   */
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /typeof body\.onlyEmail === "string" && body\.onlyEmail\.trim\(\)/);
  assert.match(route, /: null;/);
});
