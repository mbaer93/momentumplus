import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/*
 * The TSLS bridge must not sit on a Save button (2026-08-19).
 *
 * Four save paths — profile, speaker studio, sponsor studio, admin sponsor
 * edit — awaited the bridge and then discarded the result. push() carries an
 * 8-second timeout, so a slow or unreachable TSLS added up to 8 seconds to a
 * button whose real work was already done. The save was never at risk; the
 * wait was pure, and worst on exactly the corporate networks our testers use.
 *
 * The one legitimate await is the admin roster-sync button, which REPORTS
 * what the bridge said — there the wait is the point.
 */

test("no save path blocks on the TSLS bridge", () => {
  const hits = execFileSync(
    "grep",
    [
      "-rn",
      "--include=*.ts",
      "await push\\(Person\\|Sponsor\\)ToTsls",
      "app",
      "lib",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  for (const line of hits) {
    /*
     * Allowed only where the caller shows the result to the person who
     * pressed the button — `const result = await push…`. A bare await is
     * someone waiting on a network round trip for nothing.
     */
    assert.match(
      line,
      /(const|let)\s+\w+\s*=\s*await push/,
      `${line.split(":").slice(0, 2).join(":")} blocks a save on the TSLS ` +
        `bridge and throws the answer away — use mirrorToTslsAfterResponse()`,
    );
  }
});

test("the deferred path uses after(), not a floating promise", () => {
  /*
   * On serverless a promise nobody awaits can be killed the instant the
   * response returns. Dropping the await without after() would make the
   * sync LESS reliable than blocking was — a silent regression that only
   * shows up as TSLS quietly drifting out of date.
   */
  const src = readFileSync("lib/tsls-bridge.ts", "utf8");
  assert.match(src, /import \{ after \} from "next\/server"/);
  const helper = src.slice(src.indexOf("export function mirrorToTslsAfterResponse"));
  assert.match(helper, /after\(async \(\) =>/);
});

test("a failed mirror is logged, not swallowed", () => {
  // The four callers discarded the result, so a bridge that had been down
  // for a week looked exactly like one that was fine.
  const src = readFileSync("lib/tsls-bridge.ts", "utf8");
  const helper = src.slice(src.indexOf("export function mirrorToTslsAfterResponse"));
  assert.match(helper, /console\.warn/);
  // And the helper itself can never throw into the response.
  assert.match(helper, /catch \(e\)/);
});
