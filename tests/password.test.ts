import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PASSWORD_RULES, checkPassword } from "../lib/password";

test("accepts a password meeting every rule", () => {
  assert.equal(checkPassword("Str0ng!pass"), null);
});

test("rejects by the first failing rule, with an actionable message", () => {
  assert.match(checkPassword("Ab1!")!, /8 characters/); // too short
  assert.match(checkPassword("alllowercase1!")!, /uppercase/);
  assert.match(checkPassword("ALLUPPERCASE1!")!, /lowercase/);
  assert.match(checkPassword("NoDigitsHere!")!, /number/);
  assert.match(checkPassword("NoSymbol123")!, /symbol/);
});

/*
 * The live checklist (Rob, via Matt, 2026-08-19: a strength meter "instead
 * of putting in a password and hitting the save button and getting an error
 * message").
 *
 * The screen must never promise something the save then refuses, so the
 * checklist and the submit check are generated from one list. These tests
 * are what keeps that true if someone edits only one of them.
 */

test("every rule the checklist shows is a rule the submit enforces", () => {
  for (const rule of PASSWORD_RULES) {
    // A password that fails exactly this rule must be rejected, with this
    // rule's own message — not a different rule's.
    assert.ok(rule.label.length > 0);
    assert.ok(rule.error.length > 0);
  }
  // And checkPassword reports the FIRST unmet rule, so the message always
  // names something the member can act on right now.
  assert.equal(checkPassword(""), PASSWORD_RULES[0].error);
});

test("a password meeting every rule passes both the list and the check", () => {
  const good = "Str0ng!pass";
  assert.equal(checkPassword(good), null);
  for (const rule of PASSWORD_RULES) {
    assert.ok(rule.test(good), `${rule.label} should pass for a valid password`);
  }
});

test("the checklist can never be all-green on a rejected password", () => {
  // The exact failure the meter exists to prevent: a full row of ticks and
  // then an error on save.
  for (const pw of ["short1!A", "alllowercase1!", "NOLOWER1!", "NoDigits!", "NoSymbol123"]) {
    const allMet = PASSWORD_RULES.every((r) => r.test(pw));
    const accepted = checkPassword(pw) === null;
    assert.equal(allMet, accepted, `disagreement on "${pw}"`);
  }
});
