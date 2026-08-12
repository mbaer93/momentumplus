import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PROBED_SELECTS } from "../lib/db-selects.generated";
import {
  embeddedRelations,
  findSelects,
  hasEmbed,
  isUnresolved,
  resolveConstants,
} from "../lib/db-select-scan";

/*
 * lib/db-selects.generated.ts lists every select the app performs. The
 * health check runs all of them against the database every six hours.
 *
 * The list is generated rather than curated because the 2026-08-12 outage
 * broke a query nobody was watching — a registry containing only the queries
 * somebody remembered to add has exactly that hole. It covered only embedded
 * selects for one day, until the probe found a plain column list
 * (enrollments.created_at) that had been wrong since it was written.
 *
 * These tests keep the committed file honest about what the source does.
 */

test("the generated registry is up to date with the source", async () => {
  const { buildRegistry, renderRegistry } = await import(
    "../scripts/sync-db-selects.mjs"
  );
  const expected = renderRegistry(buildRegistry());
  const actual = readFileSync("lib/db-selects.generated.ts", "utf8");
  assert.equal(
    actual,
    expected,
    "lib/db-selects.generated.ts is stale — run `npm run selects:sync`. " +
      "Until you do, the health check is probing a query the app no longer " +
      "makes, and not probing one it does.",
  );
});

test("every select in the source is probed", () => {
  const missing: string[] = [];
  for (const found of findSelects()) {
    const select = resolveConstants(found.select);
    // Selects whose table comes from a template variable cannot be probed;
    // the generator refuses them and the previous test pins the generator.
    if (isUnresolved(select)) continue;
    if (!PROBED_SELECTS.some((p) => p.select === select)) {
      missing.push(`${found.file}: ${select.slice(0, 80)}`);
    }
  }
  assert.deepEqual(missing, [], `Unprobed selects:\n  ${missing.join("\n  ")}`);
});

test("the registry covers the query that caused the outage", () => {
  // A live anchor, not a formality: if this select ever falls out of the
  // registry, the one query already proven to break silently is unwatched
  // again. It must carry the disambiguating hint, too.
  const sessions = PROBED_SELECTS.filter((p) => p.table === "sessions");
  assert.ok(sessions.length > 0, "no sessions select is probed");
  const hinted = sessions.filter((p) =>
    p.select.includes("speakers!sessions_speaker_id_fkey"),
  );
  assert.ok(
    hinted.length >= 3,
    `expected the three SESSION_SELECT fallback tiers to be probed, got ${hinted.length}`,
  );
});

test("the scanner recognises the embed shapes the app uses", () => {
  // Without this, a pattern that quietly matched nothing would report full
  // coverage of an empty set.
  assert.equal(hasEmbed("id, title, profiles ( email )"), true);
  assert.equal(hasEmbed("id, memberships!inner ( tier )"), true);
  assert.equal(hasEmbed("id, ${SPEAKER_FROM_SESSION} ( name )"), true);
  assert.equal(hasEmbed("id, title, starts_at"), false);
  assert.deepEqual(
    embeddedRelations("a, profiles ( full_name ), sessions ( title )"),
    ["profiles", "sessions"],
  );
  // Nested relations count — an ambiguous embed one level down still throws.
  assert.deepEqual(
    embeddedRelations("id, sessions ( speakers ( name ) )"),
    ["sessions", "speakers"],
  );
});

test("resolveConstants produces something PostgREST could accept", () => {
  const resolved = resolveConstants("id, ${SPEAKER_FROM_SESSION} ( name )");
  assert.equal(resolved, "id, speakers!sessions_speaker_id_fkey ( name )");
  assert.equal(isUnresolved(resolved), false);
  assert.equal(isUnresolved("id, ${SOMETHING_ELSE} ( name )"), true);
});
