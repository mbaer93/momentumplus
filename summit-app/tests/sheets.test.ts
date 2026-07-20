import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegistrationSheet } from "../lib/sheets";

test("parseRegistrationSheet reads header-driven columns in any order", () => {
  const rows = parseRegistrationSheet([
    ["Email Address", "Registration Type", "Full Name", "Processed"],
    ["a@b.com", "VIP", "Ada Lovelace", ""],
    // Momentum+'s processed marker is ignored — this app keys idempotency
    // on its own attendees table, so already-processed rows still import.
    ["c@d.com", "General Admission", "Grace Hopper", "processed 2026-07-01"],
    ["", "VIP", "No Email", ""],
    ["not-an-email", "VIP", "Bad Email", ""],
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rowNumber: 2,
    name: "Ada Lovelace",
    email: "a@b.com",
    registrationType: "VIP",
  });
  assert.equal(rows[1].email, "c@d.com");
});

test("parseRegistrationSheet handles missing name column and empty sheets", () => {
  assert.deepEqual(parseRegistrationSheet([]), []);
  const rows = parseRegistrationSheet([
    ["Email", "Type"],
    ["a@b.com", "vip"],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "");
});
