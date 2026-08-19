import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isPlausibleEventYear,
  missingEventYearMessage,
} from "../lib/tsls-event-year";

/*
 * Which TSLS season the registration import writes into
 * (Matt, 2026-08-19: "I don't want to be bound by 2026").
 *
 * import_log is `unique (email, event_year)`. A stale year does not fail
 * loudly — it skips exactly the people who came last year and came back,
 * while first-time registrants keep importing and every count looks normal.
 * That is the failure these tests exist to keep fixed.
 */

test("only real season years are accepted from either source", () => {
  assert.ok(isPlausibleEventYear(2026));
  assert.ok(isPlausibleEventYear(2030));
  // A bridge answering 0, null, or a string must not become the scope that
  // decides who has already been imported.
  for (const bad of [2019, 0, -1, 2026.5, "2026", null, undefined, NaN, {}]) {
    assert.equal(isPlausibleEventYear(bad), false, `accepted ${String(bad)}`);
  }
});

test("the refusal message names both fixes and rules out the clock", () => {
  const msg = missingEventYearMessage("TSLS returned 500");
  assert.match(msg, /TSLS_EVENT_YEAR/);
  assert.match(msg, /TSLS returned 500/, "the underlying reason must survive");
  // The one thing that must never be done, said plainly, because the next
  // person to read this under time pressure will be tempted by it.
  assert.match(msg, /re-import and re-grant/);
});

test("the year is never inferred from the current date", () => {
  /*
   * The whole point. A January run inferring the new year opens a fresh
   * idempotency scope and re-imports — and re-grants — everyone from the
   * October before. Refusing to run is the safe failure.
   */
  const src = readFileSync("lib/tsls-event-year.ts", "utf8");
  assert.doesNotMatch(src, /getFullYear|Date\.now|new Date/);
});

test("a bridge failure falls back rather than taking the import down", () => {
  const src = readFileSync("lib/tsls-event-year.ts", "utf8");
  // fetchTslsSpeakers already catches its own failures; resolveEventYear
  // wraps it anyway so a change there cannot start throwing into a cron.
  assert.match(src, /try \{/);
  assert.match(src, /catch \(e\)/);
  assert.match(src, /source: "env"/);
});

test("the import asks TSLS instead of reading the env var directly", () => {
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  assert.match(route, /resolveEventYear\(\)/);
  // The old code read process.env.TSLS_EVENT_YEAR here. If that comes back,
  // the annual silent-skip bug comes back with it.
  assert.doesNotMatch(route, /process\.env\.TSLS_EVENT_YEAR/);
});

test("every run records which season it wrote into, and who decided", () => {
  /*
   * A stale year changes no count — it only skips returning attendees. So
   * the heartbeat on Admin → Connections is the only place the mistake can
   * be seen, and it has to name the year AND the source: running on the
   * fallback is fine for an afternoon and a problem for a season.
   */
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  const heartbeat = route.slice(route.indexOf('recordCronRun(\n    "tsls-import"'));
  assert.match(heartbeat, /\$\{eventYear\} season/);
  assert.match(heartbeat, /per TSLS_EVENT_YEAR/);
});

test("skipped registration types reach the heartbeat, not just the JSON", () => {
  /*
   * A type missing from TSLS_TYPE_MAP is skipped: not an import, not an
   * error, and the row is left unprocessed for a later run. So a map that
   * misses the type everybody registers under reports "imported=0 errors=0"
   * — indistinguishable from a quiet week, on the one screen anyone looks
   * at. The map is hand-written and matched exactly after lowercasing, so a
   * discount label like "General Admission - Student" with no key is the
   * likely way it happens (Matt, 2026-08-19).
   */
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  const heartbeat = route.slice(route.indexOf('recordCronRun(\n    "tsls-import"'));
  assert.match(heartbeat, /skippedUnmappedTypes/);
  assert.match(heartbeat, /TSLS_TYPE_MAP/, "name the fix, not just the symptom");
});
