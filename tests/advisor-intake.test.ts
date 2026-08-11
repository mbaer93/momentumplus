import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_INTAKE,
  INTAKE_SECTIONS,
  SESSION_INCLUDES_OPTIONS,
  SOCIAL_PLATFORMS,
  allIntakeFields,
  displayAnswer,
  fieldIsVisible,
  intakeIsComplete,
  intakeRequired,
  missingRequired,
  type AdvisorIntake,
} from "../lib/advisor-intake";
import { intakeToRow, rowToIntake } from "../lib/advisor-intake-db";
import { AGREEMENT_SECTIONS } from "../lib/advisor-agreement";

/*
 * The Advisor session intake. This form is not the TSLS Speaker Tech
 * Questionnaire — the tests below pin the two things that matter: every
 * question traces to a clause of the agreement, and a half-filled intake
 * round-trips through the database without inventing answers.
 */

const filled = (over: Partial<AdvisorIntake> = {}): AdvisorIntake => ({
  ...EMPTY_INTAKE,
  sessionTitle: "Leading Through the Messy Middle",
  sessionDescription: "A practical hour on holding a team together mid-change.",
  panelAvailable: true,
  ...over,
});

test("only Advisors are asked — main speakers answer the TSLS form instead", () => {
  assert.equal(intakeRequired({ tslsMainSpeaker: false }), true);
  assert.equal(intakeRequired({ tslsMainSpeaker: true }), false);
});

test("the agreement waiver does not waive the intake", () => {
  // Waiving the SIGNATURE says the contract is handled elsewhere. It says
  // nothing about whether SLC still needs a session title from them, so the
  // gate function deliberately doesn't look at the waiver at all.
  assert.equal(intakeRequired({ tslsMainSpeaker: false }), true);
});

test("required answers are the ones SLC can't schedule or promote without", () => {
  assert.equal(intakeIsComplete(EMPTY_INTAKE), false);
  assert.deepEqual(
    missingRequired(EMPTY_INTAKE).map((m) => m.field),
    ["sessionTitle", "sessionDescription", "panelAvailable"],
  );

  assert.equal(intakeIsComplete(filled()), true);

  // "No, I can't make the panel" is an ANSWER, not a blank — §3 says an
  // absence doesn't disqualify anyone, so false must satisfy the field.
  assert.equal(intakeIsComplete(filled({ panelAvailable: false })), true);

  // Whitespace is not an answer.
  assert.equal(intakeIsComplete(filled({ sessionTitle: "   " })), false);
});

test("conditional fields appear only when their trigger is answered yes", () => {
  const slidesFormat = allIntakeFields().find((f) => f.key === "slidesFormat")!;
  assert.equal(fieldIsVisible(slidesFormat, filled({ usesSlides: true })), true);
  assert.equal(fieldIsVisible(slidesFormat, filled({ usesSlides: false })), false);
  // Unanswered is not "yes" — the follow-up stays hidden until they choose.
  assert.equal(fieldIsVisible(slidesFormat, filled({ usesSlides: null })), false);

  // §3's conflict box is the mirror image: it shows when they CAN'T make it.
  const conflicts = allIntakeFields().find((f) => f.key === "panelConflictNotes")!;
  assert.equal(fieldIsVisible(conflicts, filled({ panelAvailable: false })), true);
  assert.equal(fieldIsVisible(conflicts, filled({ panelAvailable: true })), false);

  // An unconditional field is always in play.
  const title = allIntakeFields().find((f) => f.key === "sessionTitle")!;
  assert.equal(fieldIsVisible(title, EMPTY_INTAKE), true);
});

test("every question cites a clause, and §6's list is verbatim", () => {
  for (const field of allIntakeFields()) {
    assert.ok(
      field.clause.trim().length > 0,
      `${String(field.key)} has no clause reference — every question must trace to one`,
    );
  }

  // The eight §6 items, in the document's order, exactly as written.
  const six = AGREEMENT_SECTIONS.find((s) => s.n === 6)!;
  const sixList = six.blocks.find((b) => b.kind === "ul");
  assert.ok(sixList && sixList.kind === "ul");
  assert.deepEqual([...SESSION_INCLUDES_OPTIONS], sixList.items);
});

test("no duplicate field keys across sections", () => {
  const keys = allIntakeFields().map((f) => String(f.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(INTAKE_SECTIONS.every((s) => s.fields.length > 0));
});

test("a half-filled intake round-trips through the row mapping", () => {
  const intake = filled({
    phone: "  (540) 348-4769  ",
    sessionIncludes: ["Case examples", "Guided reflection"],
    usesSlides: true,
    slidesFormat: "Keynote",
    needsAv: false,
    socialHandles: { LinkedIn: " @someone ", Threads: "   " },
    preferredSessionDate: "2027-02-18",
  });
  const row = intakeToRow("spk-1", "prof-1", intake);

  assert.equal(row.speaker_id, "spk-1");
  assert.equal(row.phone, "(540) 348-4769");
  // A blank optional field stores as NULL, not "".
  assert.equal(row.session_takeaways, null);
  // Sierra's note on the TSLS form: platforms they don't use are left blank,
  // and a blank is not a handle — it must not reach the database.
  assert.deepEqual(row.social_handles, { LinkedIn: "@someone" });
  // false is a real answer and must survive; null must stay null.
  assert.equal(row.needs_av, false);
  assert.equal(row.can_join_early, null);
  assert.equal(row.preferred_session_date, "2027-02-18");

  const back = rowToIntake(row as Record<string, unknown>);
  assert.equal(back.sessionTitle, intake.sessionTitle);
  assert.equal(back.needsAv, false);
  assert.equal(back.canJoinEarly, null);
  assert.deepEqual(back.sessionIncludes, ["Case examples", "Guided reflection"]);
  assert.deepEqual(back.socialHandles, { LinkedIn: "@someone" });
});

test("a junk date never reaches a date column", () => {
  // The date input can be cleared to "", and a hand-rolled POST can send
  // anything; either way Postgres would reject it, so it becomes NULL here.
  for (const bad of ["", "not-a-date", "2027-2-1", "02/18/2027"]) {
    const row = intakeToRow("s", null, filled({ preferredSessionDate: bad }));
    assert.equal(row.preferred_session_date, null, `"${bad}" should not be stored`);
  }
});

test("a null row from the database reads as an empty intake, not as answers", () => {
  // Every column NULL is what a freshly-inserted draft looks like. Nothing
  // may come back as false or "" and read to an admin as a real answer.
  const empty = rowToIntake({
    phone: null,
    uses_slides: null,
    session_includes: null,
    social_handles: null,
  });
  assert.equal(empty.phone, "");
  assert.equal(empty.usesSlides, null);
  assert.deepEqual(empty.sessionIncludes, []);
  assert.deepEqual(empty.socialHandles, {});
});

test("unanswered questions display as nothing, and No displays as No", () => {
  const yesno = allIntakeFields().find((f) => f.key === "needsAv")!;
  assert.equal(displayAnswer(yesno, filled({ needsAv: null })), null);
  assert.equal(displayAnswer(yesno, filled({ needsAv: false })), "No");
  assert.equal(displayAnswer(yesno, filled({ needsAv: true })), "Yes");

  const list = allIntakeFields().find((f) => f.key === "sessionIncludes")!;
  assert.equal(displayAnswer(list, EMPTY_INTAKE), null);
  assert.equal(
    displayAnswer(list, filled({ sessionIncludes: ["Case examples"] })),
    "Case examples",
  );

  const social = allIntakeFields().find((f) => f.key === "socialHandles")!;
  assert.equal(displayAnswer(social, EMPTY_INTAKE), null);
  assert.equal(
    displayAnswer(social, filled({ socialHandles: { LinkedIn: "@x" } })),
    "LinkedIn: @x",
  );
});

test("the social platform list matches the one Sierra already tags", () => {
  assert.deepEqual(
    [...SOCIAL_PLATFORMS],
    ["Facebook", "Instagram", "Threads", "X (Twitter)", "LinkedIn", "TikTok", "YouTube"],
  );
});
