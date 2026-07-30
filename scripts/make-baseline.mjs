import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Concatenates every migration, in order, into supabase/baseline.sql — one
 * paste in the Supabase SQL editor stands up a fresh (staging/test) database
 * identical to production's schema. Re-run after adding a migration:
 *
 *   node scripts/make-baseline.mjs
 *
 * The baseline is generated output; never edit it by hand.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let out = `-- GENERATED FILE — do not edit. Rebuild with: node scripts/make-baseline.mjs
-- Full schema baseline: every migration in order (${files[0]} … ${files[files.length - 1]}).
-- Run ONCE against a FRESH Supabase project to mirror production's schema.
-- Never run this against the production database.

`;

for (const f of files) {
  out += `\n-- ============================================================\n-- ${f}\n-- ============================================================\n`;
  out += readFileSync(join(dir, f), "utf8").trimEnd() + "\n";
}

writeFileSync(join(process.cwd(), "supabase", "baseline.sql"), out);
console.log(`baseline.sql written: ${files.length} migrations, ${out.length} chars`);
