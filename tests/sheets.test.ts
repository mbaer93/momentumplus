import { test } from "node:test";
import assert from "node:assert/strict";
import { columnLetter, parseRegistrationSheet } from "../lib/sheets";

test("parseRegistrationSheet reads header-driven columns in any order", () => {
  const { rows, processedCol } = parseRegistrationSheet([
    ["Email Address", "Registration Type", "Full Name", "Processed"],
    ["a@b.com", "VIP", "Ada Lovelace", ""],
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
    processed: false,
  });
  assert.equal(rows[1].processed, true);
  assert.equal(processedCol, 3);
});

test("parseRegistrationSheet appends a processed column when absent", () => {
  const { rows, processedCol } = parseRegistrationSheet([
    ["Name", "Email", "Type"],
    ["Ada", "a@b.com", "vip"],
  ]);
  assert.equal(processedCol, 3);
  assert.equal(rows[0].processed, false);
});

test("parseRegistrationSheet handles empty/headerless sheets safely", () => {
  assert.deepEqual(parseRegistrationSheet([]), { rows: [], processedCol: 0 });
  const noEmail = parseRegistrationSheet([["Name", "Type"], ["Ada", "vip"]]);
  assert.equal(noEmail.rows.length, 0);
});

test("columnLetter converts indices to A1 letters", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(3), "D");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(27), "AB");
});
