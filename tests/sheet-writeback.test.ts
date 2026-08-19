import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sheetWritebackEnabled, writeSheetCell } from "../lib/sheets";

/*
 * The registration sheet is read-only unless asked otherwise
 * (Matt, 2026-08-19: "it is my current source of truth … when a row is added
 * there is a massive amount of workflows that stem from that").
 *
 * The "processed" stamp was never the record — import_log is `unique (email,
 * event_year)` and is consulted for every row either way. So the write buys a
 * skipped database lookup and risks two things that are not ours to risk: a
 * column position INFERRED from the header row, and firing whatever watches
 * that sheet for changes.
 */

const withEnv = (value: string | undefined, fn: () => void) => {
  const prev = process.env.TSLS_SHEET_WRITEBACK;
  if (value === undefined) delete process.env.TSLS_SHEET_WRITEBACK;
  else process.env.TSLS_SHEET_WRITEBACK = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TSLS_SHEET_WRITEBACK;
    else process.env.TSLS_SHEET_WRITEBACK = prev;
  }
};

test("writeback is off unless opted into explicitly", () => {
  withEnv(undefined, () => assert.equal(sheetWritebackEnabled(), false));
  withEnv("", () => assert.equal(sheetWritebackEnabled(), false));
  // Only "1". "true"/"yes"/"0" are the shapes a hurried env edit produces,
  // and none of them should quietly arm a write to a live sheet.
  for (const v of ["0", "true", "yes", "TRUE", "on"]) {
    withEnv(v, () => assert.equal(sheetWritebackEnabled(), false, `armed on "${v}"`));
  }
  withEnv("1", () => assert.equal(sheetWritebackEnabled(), true));
});

test("a write with writeback off is refused before any request", async () => {
  // Not left to Google to decline: reaching here with writeback off is a bug,
  // and the failure should name the setting rather than surface as a 403.
  const prev = process.env.TSLS_SHEET_WRITEBACK;
  delete process.env.TSLS_SHEET_WRITEBACK;
  try {
    await assert.rejects(
      () => writeSheetCell("fake-token", "Sheet1!Z2", "processed"),
      /TSLS_SHEET_WRITEBACK/,
    );
  } finally {
    if (prev !== undefined) process.env.TSLS_SHEET_WRITEBACK = prev;
  }
});

test("the token is minted read-only when writeback is off", () => {
  /*
   * Defence in depth: even if the refusal above were bypassed, the
   * credential itself cannot modify the sheet. Paired with sharing the sheet
   * as Viewer, there is no path by which this import edits it.
   */
  const src = readFileSync("lib/sheets.ts", "utf8");
  assert.match(src, /spreadsheets\.readonly/);
  assert.match(src, /sheetWritebackEnabled\(\) \? SCOPE_RW : SCOPE_RO/);
});

test("the import skips the stamp rather than attempting and swallowing it", () => {
  // markProcessed used to swallow every failure, so a refused write would
  // have been invisible. With writeback off it must not attempt one at all.
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  const fn = route.slice(route.indexOf("async function markProcessed"));
  assert.match(fn, /if \(!sheetWritebackEnabled\(\)\) return;/);
  assert.ok(
    fn.indexOf("sheetWritebackEnabled") < fn.indexOf("writeSheetCell"),
    "the guard must come before the write",
  );
});

test("the heartbeat says whether the sheet was touched", () => {
  // "Did that thing edit my spreadsheet?" should be answerable from
  // Admin → Connections, not by opening the sheet and looking.
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  assert.match(route, /sheet read-only, not modified/);
});

test("correctness does not depend on the stamp", () => {
  /*
   * The reason turning it off is safe: every row is checked against
   * import_log before anything is granted. row.processed is only a fast
   * skip. If that lookup were ever made conditional on the stamp, disabling
   * writeback would start double-granting.
   */
  const route = readFileSync("app/api/import/tsls/route.ts", "utf8");
  const loop = route.slice(route.indexOf("for (const row of rows)"));
  const logCheck = loop.indexOf('.from("import_log")');
  const grant = loop.indexOf('.from("memberships")');
  assert.ok(logCheck > 0 && grant > logCheck, "import_log must be checked before granting");
});
