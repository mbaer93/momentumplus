import assert from "node:assert/strict";
import { test } from "node:test";
import { speakerNameKey, findLikelyDuplicates } from "../lib/tsls-speakers";

/*
 * Every mismatch here becomes a duplicate speaker row on the next TSLS
 * pull — that is exactly how a real pull duplicated its speakers instead
 * of updating them (Matt, 2026-08-11). The two directions are not
 * symmetric: a missed match leaves a duplicate an admin can merge, while
 * an over-eager match silently folds two different people into one row.
 * The second is worse, so the "must not match" block matters more.
 */

const SAME: [string, string][] = [
  ["Dr. Jane Smith", "Jane Smith"],
  ["Rev. Dr. Marcus Hall", "Marcus Hall"],
  ["Pastor Marcus Hall", "Marcus Hall"],
  ["Jane Smith PhD", "Jane Smith"],
  ["John Smith Jr", "John Smith"],
  ["John Smith Jr.", "John Smith"],
  ["Holly Bertone, PMP", "Holly Bertone"],
  ["John Q. Public", "John Public"],
  ["Mary  Jane   Smith", "Mary Jane Smith"],
  ["O’Brien Kelly", "O'Brien Kelly"],
  ["JANE SMITH", "  jane smith "],
  ["Anne-Marie Diaz", "Anne Marie Diaz"],
  ["José Álvarez", "Jose Alvarez"],
  ["Prof. Ada B. Lovelace III", "Ada Lovelace"],
];

for (const [a, b] of SAME) {
  test(`matches: ${JSON.stringify(a)} = ${JSON.stringify(b)}`, () => {
    assert.equal(speakerNameKey(a), speakerNameKey(b));
  });
}

const DIFFERENT: [string, string][] = [
  ["Jane Smith", "John Smith"],
  ["Anne Marie Diaz", "Anne Diaz"],
  // A final single letter stays: dropping it would merge two people, and
  // "V" as a Roman numeral is rarer than "V" as a real initial.
  ["John V", "John"],
];

for (const [a, b] of DIFFERENT) {
  test(`stays distinct: ${JSON.stringify(a)} != ${JSON.stringify(b)}`, () => {
    assert.notEqual(speakerNameKey(a), speakerNameKey(b));
  });
}

test("a surname that looks like a credential is never stripped", () => {
  // "Ma" is a common surname. Treating it as a Master of Arts would erase
  // it and fold this person into a different one.
  assert.equal(speakerNameKey("Robert Wei Ma"), "robert wei ma");
  assert.equal(speakerNameKey("Wei Ma"), "wei ma");
  assert.notEqual(speakerNameKey("Robert Wei Ma"), speakerNameKey("Robert Wei"));
});

test("an all-honorific string does not normalize to nothing", () => {
  // Stripping must never empty the key — an empty key would match every
  // other empty key and merge unrelated rows.
  assert.notEqual(speakerNameKey("Dr."), "");
  assert.notEqual(speakerNameKey("Dr. Jr."), "");
});

test("findLikelyDuplicates groups rows sharing a normalized name", () => {
  const dupes = findLikelyDuplicates([
    { id: "1", name: "Jane Smith" },
    { id: "2", name: "Dr. Jane Smith" },
    { id: "3", name: "Marcus Hall" },
    { id: "4", name: "Holly Bertone, PMP" },
    { id: "5", name: "Holly Bertone" },
  ]);
  assert.equal(dupes.length, 2);
  const keys = dupes.map((d) => d.key).sort();
  assert.deepEqual(keys, ["holly bertone", "jane smith"]);
  const jane = dupes.find((d) => d.key === "jane smith")!;
  assert.deepEqual(
    jane.rows.map((r) => r.id).sort(),
    ["1", "2"],
  );
});

test("findLikelyDuplicates reports nothing for a clean list", () => {
  assert.deepEqual(
    findLikelyDuplicates([
      { id: "1", name: "Jane Smith" },
      { id: "2", name: "Marcus Hall" },
    ]),
    [],
  );
});
