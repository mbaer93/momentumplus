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
