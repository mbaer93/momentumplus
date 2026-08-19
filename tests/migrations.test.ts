import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Invariants over the migration files themselves (Phase 8).
 *
 * All three hold today. None of them was checked, which is the point: they
 * are the kind of thing that stays true until the one time it doesn't, and
 * the failure is silent. A table shipped without RLS is readable by every
 * signed-in member with an anon key and nothing in the app looks wrong —
 * CLAUDE.md rule 1 says access control lives in the database, and this is
 * what makes that a fact rather than an intention.
 */

const DIR = "supabase/migrations";
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sqlByFile = new Map(
  files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]),
);

function tablesCreated(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, sql] of sqlByFile) {
    const re = /create table(?: if not exists)?\s+(?:public\.)?"?([a-z_]+)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      if (!out.has(m[1])) out.set(m[1], file);
    }
  }
  return out;
}

function tablesWithRls(): Set<string> {
  const out = new Set<string>();
  for (const sql of sqlByFile.values()) {
    const re =
      /alter table\s+(?:public\.)?"?([a-z_]+)"?\s+enable row level security/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) out.add(m[1]);
  }
  return out;
}

test("every table created by a migration has RLS enabled", () => {
  /*
   * Rule 1 of CLAUDE.md. A table without RLS is not "unconfigured" — it is
   * open to anyone holding the anon key, and the app looks entirely normal
   * either way. The one that catches this in production is a stranger, not
   * a test run.
   */
  const created = tablesCreated();
  const rls = tablesWithRls();
  const missing = [...created].filter(([t]) => !rls.has(t));
  assert.deepEqual(
    missing.map(([t, f]) => `${t} (${f})`),
    [],
    "these tables never enable row level security",
  );
  // A guard on the guard: if the parse silently matched nothing, the check
  // above would pass while testing nothing at all.
  assert.ok(created.size > 50, `only found ${created.size} tables — parser broken?`);
});

test("migration numbers are unique", () => {
  // Two files sharing a number apply in an order nobody chose, and the
  // baseline diff in CI cannot tell you which one won.
  const seen = new Map<string, string>();
  for (const f of files) {
    const num = f.slice(0, 4);
    assert.equal(
      seen.get(num),
      undefined,
      `${f} and ${seen.get(num)} share the number ${num}`,
    );
    seen.set(num, f);
  }
});

test("migration numbers have no gaps", () => {
  /*
   * A gap means a migration was written and then deleted, or renamed after
   * someone had already applied it. Either way a database somewhere is at a
   * number this repo cannot explain.
   */
  const numbers = files.map((f) => Number(f.slice(0, 4))).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let n = numbers[0]; n < numbers[numbers.length - 1]; n++) {
    if (!numbers.includes(n)) gaps.push(n);
  }
  assert.deepEqual(gaps, [], "missing migration numbers");
});

/*
 * The one deliberate drop, named rather than pattern-matched away. 0046 cut
 * the Whitney assistant and removed its two conversation tables, which Matt
 * decided and the migration says so at the top. Allow-listing it by name
 * keeps the guard live for everything after it — an exemption nobody can
 * see is how a deliberate absence becomes an unnoticed regression.
 */
const DELIBERATE_DROPS = new Set(["0046_remove_whitney.sql"]);

test("no migration drops a table", () => {
  /*
   * Not a style rule. Every table here holds something a member or an admin
   * would notice losing — notes, attendance, badges, certificates — and a
   * migration is applied by hand against production. Renaming or archiving
   * is recoverable; a DROP is not.
   */
  const offenders: string[] = [];
  for (const [file, sql] of sqlByFile) {
    if (DELIBERATE_DROPS.has(file)) continue;
    // Ignore drops of the things migrations legitimately replace.
    const stripped = sql.replace(
      /drop (policy|index|trigger|constraint|function|view|type|column)[^;]*;/gi,
      "",
    );
    if (/\bdrop table\b/i.test(stripped)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);

  // And the allow-list must stay honest: an entry that no longer drops
  // anything is stale, and would hide a real drop added to that file later.
  for (const file of DELIBERATE_DROPS) {
    assert.ok(
      /\bdrop table\b/i.test(sqlByFile.get(file) ?? ""),
      `${file} is allow-listed but no longer drops a table — remove the exemption`,
    );
  }
});
