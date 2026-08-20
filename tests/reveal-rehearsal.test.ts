import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * The admin rehearsal button (Matt, 2026-08-20: "I can't copy/paste that it
 * throws errors").
 *
 * A second path to activation is exactly the kind of convenience that
 * quietly undoes a security decision, so what is pinned here is that it
 * stays a REHEARSAL — one guest, super-admin only, never the full reveal.
 */

const actions = () =>
  readFileSync("app/(portal)/admin/control-center/actions.ts", "utf8");
const fn = () => {
  const s = actions();
  return s.slice(s.indexOf("export async function rehearseReveal"));
};

test("an empty email activates nobody, never everybody", () => {
  /*
   * The single most dangerous input. If a blank string fell through to an
   * unscoped query, one stray click would fire the entire reveal months
   * early — every guest activated, every email sent, unrecoverable.
   */
  const src = fn();
  assert.match(src, /if \(!target\)/);
  assert.ok(
    src.indexOf("if (!target)") < src.indexOf("scheduled_gifts"),
    "the blank check must come before any query",
  );
});

test("it touches exactly one row", () => {
  const src = fn();
  assert.match(src, /\.eq\("email", target\)/);
  assert.match(src, /\.limit\(1\)/);
  // And the clock update is pinned to that row's id, not to a predicate
  // that could match more.
  assert.match(src, /\.update\(\{ starts_at: nowIso \}\)\s*\n\s*\.eq\("id", row\.id\)/);
});

test("it is Super Admin only, which means two-factor", () => {
  // requireSuper → requireAdmin → the MFA gate. A stolen password does not
  // reach this.
  for (const src of [fn(), actions().slice(actions().indexOf("export async function listParkedGuests"))]) {
    assert.match(src, /await requireSuper\(\)/);
    assert.ok(
      src.indexOf("requireSuper") < src.indexOf("createServiceClient"),
      "authorize before touching the database",
    );
  }
});

test("it runs the same activation as the on-stage press", () => {
  /*
   * The whole value of a rehearsal is that it exercises the real thing. If
   * the button had its own copy of the activation, it would prove nothing
   * about what happens on the day.
   */
  assert.match(fn(), /revealOneGuest\(/);
  const route = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  assert.match(route, /revealOneGuest\(/);
  // And the shared helper is the only place the email is composed.
  const shared = readFileSync("lib/reveal-activation.ts", "utf8");
  assert.match(shared, /activationEmailHtml\(/);
  assert.doesNotMatch(route, /activationEmailHtml\(/);
});

test("the clock moves before activation here too", () => {
  // Same trap as the endpoint: activateScheduledGift anchors on starts_at,
  // so rehearsing without moving it grants a membership that has not begun.
  const src = fn();
  assert.ok(
    src.indexOf("starts_at: nowIso") < src.indexOf("revealOneGuest("),
    "starts_at must move before activating",
  );
});

test("a missing parked row is explained, not swallowed", () => {
  assert.match(fn(), /No parked grant for that email/);
});

test("the rehearsal is audited", () => {
  // It sends a real email to a real member. That belongs in the log.
  assert.match(fn(), /audit\(auth, "reveal\.rehearse", target\)/);
});

test("the button asks twice before sending", () => {
  // It emails a real person and cannot be undone — the UI equivalent of
  // the endpoint's dryRun.
  const ui = readFileSync("components/admin/RevealRehearsal.tsx", "utf8");
  assert.match(ui, /confirming/);
  assert.match(ui, /can&apos;t be undone/);
  // The list refreshes after a send, or a stale dropdown invites a second
  // press on someone already activated.
  assert.match(ui, /const fresh = await listParkedGuests\(\)/);
});

test("the UI offers no way to activate everyone", () => {
  /*
   * The full reveal stays TSLS's button and its dedicated key. If this page
   * ever grew an "activate all", the split secret would be decorative.
   */
  const ui = readFileSync("components/admin/RevealRehearsal.tsx", "utf8");
  assert.doesNotMatch(ui, /activateAll|revealAll|onlyEmail:\s*null/i);
  assert.match(ui, /disabled=\{!email \|\| pending\}/);
});

/* --- Creating something to rehearse ON (Matt, 2026-08-20) ------------- */

const addFn = () => {
  const s = actions();
  return s.slice(s.indexOf("export async function addTestGuest"));
};

test("the test guest is provisioned quietly and PARKED", () => {
  /*
   * The whole point is a guest waiting on the reveal. Granting access now
   * would produce an ordinary member and leave nothing to rehearse on —
   * which is exactly what the admin bulk importer already does, and why it
   * could not be used for this.
   */
  const src = addFn();
  assert.match(src, /quiet: true/);
  assert.match(src, /startAt: startAt\.toISOString\(\)/);
});

test("it never passes tester:true to provisionMember", () => {
  /*
   * THE TRAP. provisionMember nulls startAt for a tester on purpose, so a
   * tester provisioned in August is not stuck behind the paywall they exist
   * to test through. Passing the flag here would grant immediately and park
   * nothing — silently producing the one thing this cannot produce.
   *
   * The flag is set on the profile afterwards instead, which hides the
   * account from member lists without touching the parked grant.
   */
  const src = addFn();
  const call = src.slice(src.indexOf("await provisionMember({"), src.indexOf("if (!res.ok)"));
  assert.ok(call.length > 40, "sliced the wrong region — the test proves nothing");
  assert.doesNotMatch(call, /tester/, "tester:true would stop the guest parking");
  // …but it is still marked one, after the fact.
  assert.match(src, /\.update\(\{ tester: true/);
  assert.ok(
    src.indexOf("provisionMember({") < src.indexOf("tester: true"),
    "the flag must be applied after provisioning, not during",
  );
});

test("the grant matches what a real guest gets", () => {
  // Duration comes from planToTier, the same table the real push uses, so
  // a rehearsal exercises the real numbers rather than invented ones.
  const src = addFn();
  assert.match(src, /planToTier\(tier === "tsls_vip" \? "tslsvip" : "attendee"\)/);
  assert.match(src, /months: mapping\.months/);
});

test("it is parked beyond event day, not on it", () => {
  // A forgotten dummy must not be swept up by the nightly gift-activate
  // cron on October 14, in the middle of the real reveal.
  assert.match(addFn(), /setFullYear\(startAt\.getFullYear\(\) \+ 1\)/);
});

test("it is Super Admin only and audited", () => {
  const src = addFn();
  assert.match(src, /await requireSuper\(\)/);
  assert.match(src, /audit\(auth, "reveal\.test_guest", target\)/);
  // An address nobody can read defeats the purpose, so it is rejected.
  assert.match(src, /target\.includes\("@"\)/);
});
