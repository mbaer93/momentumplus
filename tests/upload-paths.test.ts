import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lessonDocumentPrefix,
  pathInScope,
  safeFileName,
  scopedUploadPath,
  sessionResourcePrefix,
  speakerSharePrefix,
} from "../lib/upload-paths";

/*
 * Direct-to-storage uploads mean the storage key arrives from the browser,
 * so the guard that decides whether to record it is the only thing standing
 * between "my file" and "someone else's file". It gets tested properly.
 */

test("a path we issued for a scope is accepted", () => {
  const prefix = sessionResourcePrefix("sess-1");
  const path = scopedUploadPath(prefix, "workbook.pdf");
  assert.ok(path.startsWith(prefix));
  assert.ok(pathInScope(path, prefix));
});

test("another session's path is refused", () => {
  const mine = sessionResourcePrefix("sess-1");
  const theirs = scopedUploadPath(sessionResourcePrefix("sess-2"), "notes.pdf");
  assert.equal(pathInScope(theirs, mine), false);
});

test("traversal out of the scope is refused", () => {
  const prefix = sessionResourcePrefix("sess-1");
  assert.equal(pathInScope(`${prefix}../sess-2/notes.pdf`, prefix), false);
  assert.equal(pathInScope(`${prefix}..`, prefix), false);
  assert.equal(pathInScope(`${prefix}sub\\dir.pdf`, prefix), false);
});

test("a nested segment under the scope is refused", () => {
  // Exactly one segment: nothing may reach into a deeper scope.
  const prefix = lessonDocumentPrefix("lesson-9");
  assert.equal(pathInScope(`${prefix}deeper/file.pdf`, prefix), false);
  assert.equal(pathInScope(`${prefix}file.pdf`, prefix), true);
});

test("the prefix alone is not a file", () => {
  const prefix = speakerSharePrefix("sess-1");
  assert.equal(pathInScope(prefix, prefix), false);
});

test("empty input is refused rather than passed through", () => {
  assert.equal(pathInScope("", sessionResourcePrefix("s")), false);
  assert.equal(pathInScope("anything", ""), false);
});

test("a prefix that merely starts the same doesn't match", () => {
  // "sess-10" must not satisfy the guard for "sess-1".
  const mine = sessionResourcePrefix("sess-1");
  const other = scopedUploadPath(sessionResourcePrefix("sess-10"), "x.pdf");
  assert.equal(pathInScope(other, mine), false);
});

test("file names are reduced to something safe to store", () => {
  assert.equal(safeFileName("Q4 Report (final).pdf"), "Q4 Report (final).pdf");
  // ".." → "_" twice, and each "/" → "_": four separators, no dots left.
  assert.equal(safeFileName("../../etc/passwd"), "____etc_passwd");
  assert.equal(safeFileName(".."), "_");
  assert.equal(safeFileName(".hidden"), "_hidden");
  assert.equal(safeFileName(""), "file");
  assert.ok(safeFileName("a".repeat(400)).length <= 120);
});

test("a hostile file name still yields a path we accept", () => {
  /* Regression: safeFileName used to leave ".." in the result, so uploading
     a file called "../../etc/passwd" produced a path pathInScope refused —
     we'd have generated a key and then declined to record it. */
  const prefix = sessionResourcePrefix("sess-1");
  for (const evil of ["../../etc/passwd", "..", "....//..", ".hidden"]) {
    const path = scopedUploadPath(prefix, evil);
    assert.ok(pathInScope(path, prefix), `${evil} produced an unusable path`);
  }
});

test("two uploads of the same name in the same moment don't collide", () => {
  const prefix = sessionResourcePrefix("sess-1");
  const a = scopedUploadPath(prefix, "deck.pdf");
  const b = scopedUploadPath(prefix, "deck.pdf");
  assert.notEqual(a, b);
});
