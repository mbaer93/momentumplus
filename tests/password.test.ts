import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkPassword } from "../lib/password";

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
