import assert from "node:assert/strict";
import { test } from "node:test";
import {
  courseUnlocked,
  effectiveCeHours,
  gradableQuiz,
  parseDocuments,
  publicQuiz,
  type CourseItem,
  type CourseLesson,
} from "../lib/education";

/*
 * Education: course gating, the CE hours printed on a certificate, and the
 * quiz handling that decides whether someone passed.
 *
 * Two of these carry real consequences beyond a wrong pixel — CE hours go on
 * a certificate a member may submit for professional credit, and publicQuiz
 * is what keeps correct answers on the server.
 */

function lesson(over: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: "l1",
    title: "Lesson",
    summary: "",
    videoId: null,
    content: "",
    imageUrl: null,
    documents: [],
    quiz: null,
    completed: false,
    ...over,
  };
}

function course(over: Partial<CourseItem> = {}): CourseItem {
  return {
    id: "c1",
    title: "Course",
    description: "",
    category: "leadership",
    minAccess: "all_members",
    published: true,
    ceHours: null,
    lessons: [],
    completedCount: 0,
    ...over,
  };
}

/* ---- gating ------------------------------------------------------------ */

test("an all_members course is open to every tier, including the free comps", () => {
  for (const tier of ["basic", "gift", "vip", "tsls_attendee"] as const) {
    assert.equal(courseUnlocked(course(), tier), true, tier);
  }
});

test("vip_plus courses are closed to the `vip` comp tier", () => {
  // The trap: `vip` is a 3-month comp of BASIC access and deliberately does
  // not satisfy vip_plus. Reading the tier name alone gets this backwards.
  const c = course({ minAccess: "vip_plus" });
  assert.equal(courseUnlocked(c, "vip"), false);
  assert.equal(courseUnlocked(c, "basic"), false);
  assert.equal(courseUnlocked(c, "tsls_vip"), true);
  assert.equal(courseUnlocked(c, "pro"), true);
});

test("pro_only courses admit pro, sponsor and admin, and nobody else", () => {
  const c = course({ minAccess: "pro_only" });
  for (const tier of ["pro", "sponsor", "admin"] as const) {
    assert.equal(courseUnlocked(c, tier), true, tier);
  }
  for (const tier of ["basic", "vip", "tsls_vip", "speaker", "sub_annual"] as const) {
    assert.equal(courseUnlocked(c, tier), false, tier);
  }
});

/* ---- CE hours on the certificate --------------------------------------- */

test("a course with no test anywhere is capped at half an hour", () => {
  // Matt's rule: full credit requires passing a test at 75%+. Without a test
  // the course still awards something, but not the advertised total.
  assert.equal(effectiveCeHours(course({ ceHours: 3, lessons: [lesson()] })), 0.5);
});

test("the cap never inflates a course worth less than it", () => {
  assert.equal(effectiveCeHours(course({ ceHours: 0.25, lessons: [lesson()] })), 0.25);
});

test("one tested lesson unlocks the course's full hours", () => {
  const tested = lesson({ id: "l2", quiz: [{ q: "?", options: ["a", "b"] }] });
  assert.equal(
    effectiveCeHours(course({ ceHours: 3, lessons: [lesson(), tested] })),
    3,
  );
});

test("an empty quiz array is not a test", () => {
  assert.equal(
    effectiveCeHours(course({ ceHours: 3, lessons: [lesson({ quiz: [] })] })),
    0.5,
  );
});

test("a course awarding no CE stays null rather than becoming 0.5", () => {
  // null means "no certificate hours at all" — distinct from a capped 0.5.
  assert.equal(effectiveCeHours(course({ ceHours: null, lessons: [lesson()] })), null);
});

/* ---- documents --------------------------------------------------------- */

test("lesson documents survive a well-formed list and drop the unusable", () => {
  const docs = parseDocuments([
    { name: "Workbook", url: "https://x/w.pdf" },
    { name: "No URL" },
    { url: "https://x/untitled.pdf" },
    "not an object",
    null,
  ]);
  assert.deepEqual(docs, [
    { name: "Workbook", url: "https://x/w.pdf" },
    { name: "Document", url: "https://x/untitled.pdf" },
  ]);
});

test("a non-array documents column yields an empty list, not a crash", () => {
  // This column is JSON from the database; it has held null and {} before.
  for (const raw of [null, undefined, {}, "", 0]) {
    assert.deepEqual(parseDocuments(raw), []);
  }
});

/* ---- quizzes ----------------------------------------------------------- */

test("publicQuiz never ships the answer key to the browser", () => {
  const out = publicQuiz({
    questions: [{ q: "Which?", options: ["a", "b", "c"], answer: 2 }],
  });
  assert.deepEqual(out, [{ q: "Which?", options: ["a", "b", "c"] }]);
  assert.equal(JSON.stringify(out).includes("answer"), false);
});

test("publicQuiz drops questions that can't be answered", () => {
  // Fewer than two options isn't a question, and a blank prompt isn't either.
  const out = publicQuiz({
    questions: [
      { q: "Only one", options: ["a"] },
      { q: "", options: ["a", "b"] },
      { q: "Good", options: ["a", "b"] },
    ],
  });
  assert.deepEqual(out, [{ q: "Good", options: ["a", "b"] }]);
});

test("a quiz with nothing usable left is null, not an empty test", () => {
  // null means "this lesson has no test". An empty array would read as a
  // test with no questions — which everyone passes.
  assert.equal(publicQuiz({ questions: [] }), null);
  assert.equal(publicQuiz({ questions: [{ q: "x", options: ["only"] }] }), null);
  assert.equal(publicQuiz(null), null);
  assert.equal(publicQuiz({}), null);
});

test("gradableQuiz remaps the answer index onto the options actually shown", () => {
  // The display filter drops non-string options. If grading used the raw
  // index, every answer after a dropped option would be judged against the
  // wrong choice — silently marking correct answers wrong.
  const out = gradableQuiz({
    questions: [{ q: "Which?", options: [42, "a", "b"], answer: 2 }],
  });
  assert.deepEqual(out, [{ options: ["a", "b"], answer: 1 }]);
});

test("gradableQuiz and publicQuiz agree on which questions count", () => {
  const raw = {
    questions: [
      { q: "Only one", options: ["a"], answer: 0 },
      { q: "", options: ["a", "b"], answer: 0 },
      { q: "Good", options: ["a", "b"], answer: 1 },
    ],
  };
  const shown = publicQuiz(raw) ?? [];
  const graded = gradableQuiz(raw);
  assert.equal(graded.length, shown.length);
  assert.deepEqual(
    graded.map((g) => g.options),
    shown.map((s) => s.options),
  );
});

test("a question whose answer index doesn't survive filtering grades as unanswerable", () => {
  // answer pointed at the dropped option: better to carry null than to
  // silently blame the member for a broken question.
  const out = gradableQuiz({
    questions: [{ q: "Which?", options: [42, "a", "b"], answer: 0 }],
  });
  assert.deepEqual(out, [{ options: ["a", "b"], answer: null }]);
});

test("gradableQuiz returns an empty list for a malformed column", () => {
  assert.deepEqual(gradableQuiz(null), []);
  assert.deepEqual(gradableQuiz({}), []);
  assert.deepEqual(gradableQuiz({ questions: "nope" }), []);
});
