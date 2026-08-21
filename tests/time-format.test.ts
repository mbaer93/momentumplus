import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  EVENT_TZ,
  formatAt,
  safeZone,
  showsAClock,
  type TimeStyle,
} from "../lib/time-format";

/*
 * Times in the reader's own zone (Matt, 2026-08-21: "users who are in other
 * time zones should see the adjusted time to their location. But if someone
 * travels to us for the event the times should be readjusted back to EST").
 *
 * Both halves fall out of one rule — render in the zone the DEVICE reports —
 * so what is worth pinning is the division of labour: which things follow
 * the reader, which stay on the event's clock, and the hydration trap that
 * sits under the whole idea.
 */

const read = (p: string) => readFileSync(p, "utf8");

/** 8:00 PM Eastern on a summer evening — EDT, UTC-4. */
const EVENING_ET = "2026-09-12T00:00:00.000Z"; // = Sep 11, 8:00 PM EDT

test("a session time reads in the zone it is asked for", () => {
  assert.equal(formatAt(EVENING_ET, "time", EVENT_TZ), "8:00 PM EDT");
  assert.equal(formatAt(EVENING_ET, "time", "America/Denver"), "6:00 PM MDT");
  assert.equal(formatAt(EVENING_ET, "time", "America/Los_Angeles"), "5:00 PM PDT");
});

test("the zone is always named on a clock, because 6:00 PM alone is a missed session", () => {
  /*
   * A member in Denver seeing a bare "6:00 PM" reads it as the session time
   * and shows up two hours late — or not at all. The abbreviation is the
   * whole reason localising the time is safe to do.
   */
  for (const style of ["time", "dateTime", "monthDayTime"] as TimeStyle[]) {
    assert.match(
      formatAt(EVENING_ET, style, "America/Denver"),
      /MDT|MST/,
      `${style} shows a clock without saying whose`,
    );
  }
});

test("chat timestamps are the one clock with no zone label", () => {
  // Always the reader's own, so naming the zone is noise on every line.
  assert.equal(formatAt(EVENING_ET, "timeBare", "America/Denver"), "6:00 PM");
  // Still follows the reader, though — that is what makes it "their" clock.
  assert.ok(showsAClock("timeBare"));
});

test("a bare calendar date does NOT follow the reader", () => {
  /*
   * "The September 12 session" is September 12 on everyone's ticket. A date
   * that shifted by zone would show a member on the west coast a different
   * day than the one printed on the schedule, which is worse than the
   * problem it would be solving.
   */
  for (const style of ["date", "dateLong", "monthDay", "monthAbbr", "dayOfMonth", "year"] as TimeStyle[]) {
    assert.equal(showsAClock(style), false, `${style} must not follow the reader`);
  }
});

test("defaulting the zone lands on the event, never on the renderer", () => {
  // The bug this whole file exists to prevent is a format call with no zone
  // at all, which silently uses wherever the code happens to be running.
  assert.equal(formatAt(EVENING_ET, "time"), formatAt(EVENING_ET, "time", EVENT_TZ));
});

test("an unusable zone falls back instead of throwing mid-render", () => {
  /*
   * Intl throws RangeError on an unknown IANA name, and the browser is not
   * the only source of these. A crash inside a render is a blank page; a
   * fallback is a time in the wrong zone, clearly labelled.
   */
  assert.equal(safeZone("Mars/Olympus_Mons"), EVENT_TZ);
  assert.equal(safeZone(""), EVENT_TZ);
  assert.equal(safeZone(null), EVENT_TZ);
  assert.equal(safeZone("America/Denver"), "America/Denver");
  assert.equal(formatAt(EVENING_ET, "time", "Nowhere/Real"), "8:00 PM EDT");
});

test("a junk timestamp renders as nothing, not as Invalid Date", () => {
  assert.equal(formatAt("not a date", "date"), "");
});

test("the reader's zone arrives after mount, never during render", () => {
  /*
   * THE TRAP. The server does not know the reader's zone — it is not in the
   * request. Reading it while rendering therefore produces one string on the
   * server and another in the browser, which is exactly the hydration
   * mismatch that took /admin/security down on 2026-08-21 (React #418).
   *
   * So the first render on BOTH sides uses the event's zone and the effect
   * swaps in the reader's afterwards.
   */
  const src = read("components/LocalTime.tsx");
  assert.match(src, /useState<string>\(EVENT_TZ\)/, "first render must be the event's zone");
  assert.match(src, /useEffect\(/, "the reader's zone must arrive in an effect");

  // viewerTimeZone must not be reachable from the render body.
  const body = src.slice(src.indexOf("export function LocalTime"));
  assert.doesNotMatch(
    body,
    /viewerTimeZone\(/,
    "LocalTime must read the zone from context, not from the browser during render",
  );
});

test("a date shown beside its own time can be made to follow it", () => {
  /*
   * A session card shows "Sep 12" under one icon and "8:00 PM EDT" under the
   * next. Anchored to different zones the pair could name two different days
   * for an evening session, so the date takes follow="viewer".
   */
  const src = read("components/LocalTime.tsx");
  assert.match(src, /follow\?: "viewer" \| "event"/);
  assert.match(src, /follow \?\? \(showsAClock\(style\) \? "viewer" : "event"\)/);

  for (const path of [
    "components/sessions/SessionCard.tsx",
    "components/sessions/SessionDetailView.tsx",
  ]) {
    const card = read(path);
    assert.match(card, /style="date" follow="viewer"/, `${path}: date must follow its clock`);
    assert.match(card, /style="time"/, `${path}: time must be localised`);
  }
});

test("nothing anywhere formats a date in the renderer's timezone", () => {
  /*
   * The repo-wide guard, and the real point of the sweep. A
   * toLocaleDateString with no timeZone formats in whatever zone the code
   * is running in — UTC on Vercel, the reader's own in the browser — so
   * server and client disagree and React throws the tree away.
   *
   * Number formatting (`price.toLocaleString("en-US")`) is not a date and is
   * deliberately left alone.
   */
  const files = execSync(
    "grep -rl 'toLocale' --include=*.ts --include=*.tsx components app lib",
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  const offenders: string[] = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/\.toLocale(?:Date|Time|)String\(/g)) {
      // Walk to the matching close paren so a multi-line options object is
      // read whole — checking only the first line is how one slips through.
      let j = m.index + m[0].length;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === "(" || c === "{" || c === "[") depth++;
        else if (c === ")" || c === "}" || c === "]") depth--;
        j++;
      }
      const call = src.slice(m.index, j);
      const isDate = /month:|day:|year:|hour:|minute:|weekday:|dateStyle|timeStyle/.test(call);
      if (isDate && !/timeZone:/.test(call)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${f}:${line}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `format these through lib/time-format instead:\n  ${offenders.join("\n  ")}`,
  );

  // The sweep found 53 of these. If this list is ever empty because the
  // grep stopped matching, the guard above would pass while checking
  // nothing.
  assert.ok(files.length > 10, "the scan found almost no files — the guard is not running");
});

test("an email names the zone, because it cannot know the reader's", () => {
  /*
   * The one place localisation is impossible: an email is rendered once, on
   * a server, for someone whose zone nobody asked. So it says which clock it
   * means rather than leaving a bare time to be guessed at.
   */
  const cron = read("app/api/cron/reminders/route.ts");
  for (const m of cron.matchAll(/timeZone: "America\/New_York",\s*\}\)([^\n]*)/g)) {
    assert.match(m[1], /ET/, "a reminder time must say ET");
  }
});
