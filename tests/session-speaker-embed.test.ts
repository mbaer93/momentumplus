import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SPEAKER_FROM_LINEUP,
  SPEAKER_FROM_SESSION,
} from "../lib/session-speaker-embed";

/*
 * Migration 0087 added session_speakers, a junction table between sessions
 * and speakers. PostgREST now sees TWO relationships between those tables,
 * so an unhinted `speakers ( ... )` embed fails with PGRST201 — and because
 * listSessions throws on a query error, that took every page listing a
 * session offline, /admin included.
 *
 * The failure is invisible in review (the select still reads fine) and
 * invisible in a typecheck. This scan is the thing that catches it: every
 * speakers embed in the source tree must name the foreign key it means.
 */

const ROOTS = ["app", "lib", "components", "scripts"];
const SELF = "tests/session-speaker-embed.test.ts";

/** `speakers (` not preceded by `session_` and not carrying a `!hint`. */
const UNHINTED = /(?<!session_)speakers\s*\(/;

/*
 * Only string literals are scanned. A select lives in one; the same words in
 * prose do not — "Past speakers ({n})" in JSX and "All TSLS speakers (main
 * stage...)" in a comment are English, and flagging them would train people
 * to ignore this test.
 */
const LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*?\1/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

test("every sessions -> speakers embed names its foreign key", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      if (file === SELF) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const literal of line.match(LITERAL) ?? []) {
          if (UNHINTED.test(literal)) {
            offenders.push(`${file}:${i + 1}`);
            break;
          }
        }
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Unhinted speakers embed(s) — use ${SPEAKER_FROM_SESSION} (from sessions) ` +
      `or ${SPEAKER_FROM_LINEUP} (from session_speakers):\n  ` +
      offenders.join("\n  "),
  );
});

test("the scan can tell a hinted embed from an unhinted one", () => {
  // Without this, a regex that matched nothing would report a clean tree.
  const scan = (literal: string) => UNHINTED.test(literal);
  assert.equal(scan('"id, title, speakers ( name )"'), true);
  assert.equal(scan('"id, title, speakers(name)"'), true);
  assert.equal(scan(`"id, title, ${SPEAKER_FROM_SESSION} ( name )"`), false);
  assert.equal(scan(`"session_id, ${SPEAKER_FROM_LINEUP} ( name )"`), false);
  // The junction table's own name ends in "speakers" — not an embed.
  assert.equal(scan('"session_speakers ( speaker_id )"'), false);
});

test("the hints name the foreign keys the migrations actually create", () => {
  // Both constraints are unnamed `references` clauses, so Postgres names them
  // <table>_<column>_fkey. If a migration ever names one explicitly, these
  // hints stop resolving and every session read 500s — assert the shape.
  assert.equal(SPEAKER_FROM_SESSION, "speakers!sessions_speaker_id_fkey");
  assert.equal(SPEAKER_FROM_LINEUP, "speakers!session_speakers_speaker_id_fkey");

  const init = readFileSync("supabase/migrations/0001_init.sql", "utf8");
  assert.match(
    init,
    /speaker_id uuid references speakers \(id\)/,
    "sessions.speaker_id is no longer an unnamed foreign key — the hint in " +
      "lib/session-speaker-embed.ts may no longer match its constraint name.",
  );

  const lineup = readFileSync(
    "supabase/migrations/0087_session_speakers.sql",
    "utf8",
  );
  assert.match(
    lineup,
    /speaker_id uuid not null references speakers \(id\)/,
    "session_speakers.speaker_id is no longer an unnamed foreign key — the " +
      "hint in lib/session-speaker-embed.ts may no longer match.",
  );
});
