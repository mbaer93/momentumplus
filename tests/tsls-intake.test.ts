import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOCIAL_PLATFORMS,
  TSLS_INTAKE_SECTIONS,
  allTslsFields,
  answerIsBlank,
  displayTslsAnswer,
  handleKey,
  missingTslsAnswers,
  pruneHiddenAnswers,
  sanitizeTslsAnswers,
  tslsFieldByKey,
  tslsFieldVisible,
  tslsIntakeComplete,
  tslsIntakeRequired,
  type TslsAnswers,
} from "../lib/tsls-intake";
import { coerceAnswers } from "../lib/tsls-intake-db";
import { intakeRequired as advisorIntakeRequired } from "../lib/advisor-intake";

/*
 * The TSLS Speaker Tech Questionnaire, mirrored from Sierra's Jotform
 * (250896885391071). These tests pin the things that would quietly corrupt
 * the record: who gets asked, which follow-ups appear, and that an answer to
 * a question a speaker was never asked can't survive into the row.
 */

test("mainstage speakers get this form, Advisors get the other one", () => {
  assert.equal(tslsIntakeRequired({ tslsMainSpeaker: true }), true);
  assert.equal(tslsIntakeRequired({ tslsMainSpeaker: false }), false);
});

test("the two intakes partition speakers — never both, never neither", () => {
  for (const tslsMainSpeaker of [true, false]) {
    const speaker = { tslsMainSpeaker };
    const asked = [
      tslsIntakeRequired(speaker),
      advisorIntakeRequired(speaker),
    ].filter(Boolean);
    assert.equal(
      asked.length,
      1,
      `tslsMainSpeaker=${tslsMainSpeaker} should be asked exactly one intake`,
    );
  }
});

test("every question carries its options, and the verbatim ones are intact", () => {
  const tshirt = tslsFieldByKey("tshirtSize")!;
  assert.deepEqual(
    [...(tshirt.options ?? [])],
    ["Extra Small", "Small", "Medium", "Large", "Extra large", "XXL", "XXXL"],
  );

  const mic = tslsFieldByKey("microphonePreference")!;
  assert.deepEqual(
    [...(mic.options ?? [])],
    ["No Preference", "Lapel/Lavalier mic", "Handheld"],
  );

  const movement = tslsFieldByKey("stageMovement")!;
  assert.deepEqual([...(movement.options ?? [])], ["Moving", "Standing", "Sitting"]);

  const slideshow = tslsFieldByKey("slideshow")!;
  assert.deepEqual(
    [...(slideshow.options ?? [])],
    ["Yes, PowerPoint", "Yes, Keynote", "Yes, PDF", "Yes, Google Slides", "No", "other"],
  );

  const stool = tslsFieldByKey("stoolOrChair")!;
  assert.deepEqual([...(stool.options ?? [])], ["Stool", "Chair", "No"]);

  const drink = tslsFieldByKey("drinkPreference")!;
  assert.deepEqual([...(drink.options ?? [])], ["Water", "Coffee", "Tea", "other"]);

  // The acknowledgements are the speaker agreeing to something — their
  // wording is Sierra's and must survive verbatim.
  assert.deepEqual(
    [...(tslsFieldByKey("handoutsAcknowledgement")!.options ?? [])],
    ["I understand"],
  );
  assert.deepEqual(
    [...(tslsFieldByKey("presentationDeadlineAcknowledgement")!.options ?? [])],
    ["I understand and agree to submit by the date stated."],
  );
  assert.deepEqual(
    [...(tslsFieldByKey("vipLunchAcknowledgement")!.options ?? [])],
    ["I understand and agree to this expectation"],
  );
});

test("no duplicate keys, and every section has questions", () => {
  const keys = allTslsFields().map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(TSLS_INTAKE_SECTIONS.every((s) => s.fields.length > 0));
  // Every conditional points at a question that actually exists.
  for (const field of allTslsFields()) {
    if (!field.showWhen) continue;
    assert.ok(
      tslsFieldByKey(field.showWhen.field),
      `${field.key} is conditional on ${field.showWhen.field}, which is not a question`,
    );
  }
});

test("the slideshow follow-ups appear for every Yes variant, not just PowerPoint", () => {
  const clip = tslsFieldByKey("playsClip")!;
  for (const answer of [
    "Yes, PowerPoint",
    "Yes, Keynote",
    "Yes, PDF",
    "Yes, Google Slides",
    "other",
  ]) {
    assert.equal(
      tslsFieldVisible(clip, { slideshow: answer }),
      true,
      `"${answer}" should reveal the follow-ups`,
    );
  }
  assert.equal(tslsFieldVisible(clip, { slideshow: "No" }), false);
  assert.equal(tslsFieldVisible(clip, {}), false);
});

test("the beverage follow-up appears for anything but water", () => {
  const prep = tslsFieldByKey("beveragePreparation")!;
  assert.equal(tslsFieldVisible(prep, { drinkPreference: "Water" }), false);
  for (const drink of ["Coffee", "Tea", "other"]) {
    assert.equal(tslsFieldVisible(prep, { drinkPreference: drink }), true);
  }
});

test("a social handle is asked only for a platform they selected", () => {
  const linkedin = tslsFieldByKey(handleKey("LinkedIn"))!;
  assert.equal(
    tslsFieldVisible(linkedin, { socialPlatforms: ["Facebook", "LinkedIn"] }),
    true,
  );
  assert.equal(tslsFieldVisible(linkedin, { socialPlatforms: ["Facebook"] }), false);
  // Every platform has exactly one handle question.
  for (const platform of SOCIAL_PLATFORMS) {
    assert.ok(tslsFieldByKey(handleKey(platform)), `${platform} has no handle field`);
  }
});

test("hidden follow-ups are neither required nor kept", () => {
  // Answered "No" to slideshow: the three follow-ups must not block submit.
  const answers: TslsAnswers = { slideshow: "No" };
  const blocking = missingTslsAnswers(answers).map((f) => f.key);
  assert.ok(!blocking.includes("playsClip"));
  assert.ok(!blocking.includes("needsInternet"));
  assert.ok(!blocking.includes("presentationDeadlineAcknowledgement"));

  // And a stale answer from before they switched to "No" is dropped, so an
  // admin never reads an answer to a question that wasn't asked.
  const stale: TslsAnswers = {
    slideshow: "No",
    playsClip: "Yes",
    needsInternet: "Yes",
    presentationDeadlineAcknowledgement: "I understand and agree to submit by the date stated.",
  };
  const pruned = pruneHiddenAnswers(stale);
  assert.equal(pruned.slideshow, "No");
  assert.equal(pruned.playsClip, undefined);
  assert.equal(pruned.needsInternet, undefined);
  assert.equal(pruned.presentationDeadlineAcknowledgement, undefined);
});

test("deselecting a platform drops the handle that went with it", () => {
  const pruned = pruneHiddenAnswers({
    socialPlatforms: ["Facebook"],
    [handleKey("Facebook")]: "@me",
    [handleKey("TikTok")]: "@old",
  });
  assert.equal(pruned[handleKey("Facebook")], "@me");
  assert.equal(pruned[handleKey("TikTok")], undefined);
});

test("sanitize rejects options the question never offered", () => {
  const clean = sanitizeTslsAnswers({
    tshirtSize: "Gigantic",
    microphonePreference: "Handheld",
    stoolOrChair: "Beanbag",
    socialPlatforms: ["LinkedIn", "MySpace"],
    notAQuestion: "hello",
    dietaryRestrictions: "  none  ",
  });
  assert.equal(clean.tshirtSize, undefined);
  assert.equal(clean.microphonePreference, "Handheld");
  assert.equal(clean.stoolOrChair, undefined);
  assert.deepEqual(clean.socialPlatforms, ["LinkedIn"]);
  assert.equal(clean.notAQuestion, undefined);
  // Free text is kept, trimmed.
  assert.equal(clean.dietaryRestrictions, "none");
});

test("sanitize prunes in the same pass, so a smuggled follow-up can't land", () => {
  // A hand-rolled POST claiming "No" to slideshow but supplying the
  // follow-ups must not get those follow-ups stored.
  const clean = sanitizeTslsAnswers({
    slideshow: "No",
    needsInternet: "Yes",
    stageProps: "No",
    stagePropsDetail: "a chainsaw",
  });
  assert.equal(clean.needsInternet, undefined);
  assert.equal(clean.stagePropsDetail, undefined);
});

test("completeness ignores hidden questions but holds the visible ones", () => {
  assert.equal(tslsIntakeComplete({}), false);

  const answers: TslsAnswers = {};
  for (const field of allTslsFields()) {
    if (!field.required) continue;
    if (field.showWhen) continue; // conditional: leave every trigger unset
    if (field.kind === "checkbox") {
      answers[field.key] = [field.options![0]];
    } else if (field.options) {
      answers[field.key] = field.options[0];
    } else if (field.kind === "date") {
      answers[field.key] = "2026-09-01";
    } else {
      answers[field.key] = "filled";
    }
  }
  // Picking each question's FIRST option turns some conditionals on (the
  // first slideshow option is "Yes, PowerPoint"), so the form is legitimately
  // incomplete — and the still-missing set must be exactly those follow-ups.
  const missing = missingTslsAnswers(answers).map((f) => f.key);
  for (const key of missing) {
    assert.ok(
      tslsFieldByKey(key)?.showWhen,
      `${key} is missing but is not a conditional follow-up`,
    );
  }

  // Answer the revealed follow-ups too and it completes.
  for (const field of allTslsFields()) {
    if (!field.required || !tslsFieldVisible(field, answers)) continue;
    if (!answerIsBlank(answers[field.key])) continue;
    answers[field.key] = field.options ? field.options[0] : "filled";
  }
  assert.equal(tslsIntakeComplete(answers), true);
});

test("jsonb round-trips as strings and string arrays, dropping anything else", () => {
  const coerced = coerceAnswers({
    name: "Holly Bertone",
    socialPlatforms: ["LinkedIn", 7, "YouTube"],
    someNumber: 42,
    nested: { a: 1 },
  });
  assert.equal(coerced.name, "Holly Bertone");
  assert.deepEqual(coerced.socialPlatforms, ["LinkedIn", "YouTube"]);
  assert.equal(coerced.someNumber, undefined);
  assert.equal(coerced.nested, undefined);
  assert.deepEqual(coerceAnswers(null), {});
  assert.deepEqual(coerceAnswers(["a"]), {});
});

test("unanswered questions display as nothing", () => {
  const mic = tslsFieldByKey("microphonePreference")!;
  assert.equal(displayTslsAnswer(mic, {}), null);
  assert.equal(displayTslsAnswer(mic, { microphonePreference: "Handheld" }), "Handheld");
  const platforms = tslsFieldByKey("socialPlatforms")!;
  assert.equal(
    displayTslsAnswer(platforms, { socialPlatforms: ["Facebook", "YouTube"] }),
    "Facebook, YouTube",
  );
  assert.equal(displayTslsAnswer(platforms, { socialPlatforms: [] }), null);
});
