import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Fonts are self-hosted (app/fonts.css + public/fonts).
 *
 * next/font/google fetches the files from fonts.googleapis.com during the
 * BUILD. That is an outside service on the critical path of every build and
 * every Vercel deploy: on 2026-08-12 the fetch failed on a CI runner and the
 * job died compiling app/start/page.tsx, with nothing wrong in the change
 * under test. These two checks keep it gone and keep the local files honest.
 */

const ROOTS = ["app", "lib", "components", "scripts"];
const SELF = "tests/fonts.test.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/* An import, not a mention. Several comments name the module to explain why
   it is gone, and flagging those would make this test noise. */
const GOOGLE_FONT_IMPORT = /(?:from|require\()\s*["']next\/font\/google["']/;

test("nothing imports next/font/google", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      if (file === SELF) continue;
      if (GOOGLE_FONT_IMPORT.test(readFileSync(file, "utf8"))) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "next/font/google downloads fonts at build time, which can fail a build " +
      "or a deploy on a network hiccup. Add the woff2 to public/fonts and a " +
      "@font-face rule to app/fonts.css instead:\n  " + offenders.join("\n  "),
  );
});

test("every font file app/fonts.css asks for is committed", () => {
  const css = readFileSync("app/fonts.css", "utf8");
  const referenced = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map(
    (m) => m[1],
  );
  // A mis-typed filename does not throw anywhere — the browser silently
  // falls back to a system font, which reads as "the design drifted".
  assert.ok(referenced.length > 0, "app/fonts.css references no font files");
  const missing = referenced.filter((p) => !existsSync(join("public", p)));
  assert.deepEqual(missing, [], `Missing from public: ${missing.join(", ")}`);

  // And the reverse: an orphan in public/fonts is dead weight in the repo.
  const onDisk = readdirSync("public/fonts").map((f) => `/fonts/${f}`);
  const unused = onDisk.filter((p) => !referenced.includes(p));
  assert.deepEqual(unused, [], `Unreferenced font files: ${unused.join(", ")}`);
});
