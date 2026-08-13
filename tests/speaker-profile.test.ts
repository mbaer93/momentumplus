import assert from "node:assert/strict";
import { test } from "node:test";
import {
  missingFieldsSentence,
  missingSpeakerFields,
} from "../lib/speaker-profile";

/*
 * A test speaker reached the Studio, a public speaker page, and Pro-level
 * portal access having entered only a name (Matt, 2026-08-12). The form
 * marked one field required and the server checked one field. These tests
 * pin the rule that replaced it.
 */

const COMPLETE = {
  name: "Jane Rivers",
  title: "Leadership Coach",
  bio: "Twenty years leading teams.",
  industries: ["Leadership"],
  businessName: "Rivers Coaching",
  businessDescription: "Executive coaching for new managers.",
  businessUrl: "https://rivers.example",
  phone: "+1 555 555 5555",
};

test("a fully filled profile has no gaps", () => {
  assert.deepEqual(missingSpeakerFields(COMPLETE), []);
});

test("the exact hole that was reported: a name and nothing else", () => {
  const missing = missingSpeakerFields({
    name: "Jane Rivers",
    title: null,
    bio: null,
    industries: [],
    businessName: null,
    businessDescription: null,
    businessUrl: null,
    phone: null,
  });
  assert.equal(missing.length, 7, `expected every other field: ${missing}`);
  assert.ok(missing.includes("your title"));
  assert.ok(missing.includes("your bio"));
  assert.ok(missing.includes("at least one topic"));
  assert.ok(missing.includes("your business name"));
});

for (const field of Object.keys(COMPLETE) as (keyof typeof COMPLETE)[]) {
  test(`omitting ${field} is caught`, () => {
    const partial = {
      ...COMPLETE,
      [field]: field === "industries" ? [] : null,
    };
    assert.ok(
      missingSpeakerFields(partial).length > 0,
      `${field} can be left blank — the gate has a hole`,
    );
  });
}

test("whitespace is not a value", () => {
  // "  " passes an HTML required attribute in some browsers and every
  // copy-paste. The server is the gate, so it trims.
  assert.ok(missingSpeakerFields({ ...COMPLETE, bio: "   " }).length > 0);
  assert.ok(missingSpeakerFields({ ...COMPLETE, title: "\t" }).length > 0);
  assert.ok(missingSpeakerFields({ ...COMPLETE, industries: ["  "] }).length > 0);
});

test("one name is not a name", () => {
  // The same first-and-last rule members and sponsors are held to.
  const missing = missingSpeakerFields({ ...COMPLETE, name: "Jane" });
  assert.deepEqual(missing, ["your first and last name"]);
});

test("the sentence reads like English", () => {
  assert.equal(missingFieldsSentence([]), "");
  assert.equal(missingFieldsSentence(["your bio"]), "Please add your bio.");
  assert.equal(
    missingFieldsSentence(["your title", "your bio"]),
    "Please add your title and your bio.",
  );
  assert.equal(
    missingFieldsSentence(["your title", "your bio", "a phone number"]),
    "Please add your title, your bio and a phone number.",
  );
});
