import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  checkPassword,
  passwordProgress,
} from "../lib/password";

/*
 * Policy: NIST SP 800-63B rev 4 (Matt, 2026-08-19). Twelve characters, no
 * composition rules, plus Supabase's HaveIBeenPwned check server-side.
 */

test("length is the whole policy", () => {
  assert.equal(checkPassword("a".repeat(PASSWORD_MIN_LENGTH)), null);
  assert.match(checkPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))!, /12 characters/);
});

test("no character class is required", () => {
  /*
   * Rev 4 prohibits composition rules: they reliably produce "Password1!"
   * and its cousins — a predictable transformation adding almost no entropy
   * while adding enough friction that people reuse one password everywhere.
   * A long all-lowercase passphrase must pass.
   */
  assert.equal(checkPassword("correct horse battery staple"), null);
  assert.equal(checkPassword("alllowercasenodigits"), null);
  assert.equal(checkPassword("ALLUPPERCASENODIGITS"), null);
  assert.equal(checkPassword("123456789012345678"), null);
});

test("the old eight-character passwords no longer pass", () => {
  // The exact shape the old policy encouraged, now too short. Existing
  // members keep their passwords — Supabase checks the policy at set-time —
  // so this only governs new ones and resets.
  assert.notEqual(checkPassword("Str0ng!p"), null);
  assert.notEqual(checkPassword("Passw0rd!"), null);
});

/*
 * The live checklist (Rob, via Matt, 2026-08-19: a strength meter "instead
 * of putting in a password and hitting the save button and getting an error
 * message"). The screen must never promise something the save then refuses,
 * so both are generated from one list.
 */

test("the checklist can never be all-green on a rejected password", () => {
  for (const pw of ["", "short", "Str0ng!p", "a".repeat(PASSWORD_MIN_LENGTH - 1)]) {
    assert.equal(
      PASSWORD_RULES.every((r) => r.test(pw)),
      checkPassword(pw) === null,
      `disagreement on "${pw}"`,
    );
  }
});

test("every rule carries a label and an actionable message", () => {
  for (const rule of PASSWORD_RULES) {
    assert.ok(rule.label.length > 0);
    assert.ok(rule.error.length > 0);
  }
  assert.equal(checkPassword(""), PASSWORD_RULES[0].error);
});

test("the meter grows while typing instead of snapping at the end", () => {
  /*
   * With one rule, all-or-nothing credit would leave the bar empty for
   * eleven characters and then full — which tells a member nothing at the
   * moment they most want to know whether they are getting anywhere.
   */
  assert.equal(passwordProgress(""), 0);
  const half = passwordProgress("a".repeat(PASSWORD_MIN_LENGTH / 2));
  assert.ok(half > 0 && half < 1, `expected partial progress, got ${half}`);
  assert.ok(passwordProgress("a".repeat(PASSWORD_MIN_LENGTH - 1)) < 1);
  assert.equal(passwordProgress("a".repeat(PASSWORD_MIN_LENGTH)), 1);
  // Never overflows the bar.
  assert.equal(passwordProgress("a".repeat(PASSWORD_MIN_LENGTH * 3)), 1);
});

test("the meter reads full exactly when the password is accepted", () => {
  for (const pw of ["", "short", "a".repeat(PASSWORD_MIN_LENGTH - 1), "a".repeat(PASSWORD_MIN_LENGTH)]) {
    assert.equal(
      passwordProgress(pw) === 1,
      checkPassword(pw) === null,
      `meter and policy disagree on "${pw}"`,
    );
  }
});

test("the hint tells members what to do, not just what is banned", () => {
  // Dropping the character rules without saying anything would read as a
  // lowered bar, when the bar went up.
  assert.match(PASSWORD_HINT, /12/);
  assert.match(PASSWORD_HINT, /phrase/i);
});

test("no screen hardcodes the minimum length", async () => {
  /*
   * The profile change-password form had `minLength={8}` and a submit
   * button enabled at 8 characters, left behind when the policy moved to
   * 12 (found 2026-08-19). The browser would have accepted the password,
   * the button would have enabled, and checkPassword would then have
   * refused it on submit — the precise failure the strength meter was
   * added to remove.
   *
   * Every length must come from PASSWORD_MIN_LENGTH so one edit moves them
   * all. A future move to 15 should be one line, not a search.
   */
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");

  const run = (args: string[]): string => {
    try {
      return execFileSync("grep", args, { encoding: "utf8" });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;
      return err.stdout ?? "";
    }
  };

  /*
   * Scoped to files that import the policy, which is what makes this
   * precise: an unrelated `length < 12` on an API-key field is not a
   * password rule, and flagging it would train people to ignore this test.
   */
  const owners = run([
    "-rl",
    "--include=*.tsx",
    "--include=*.ts",
    "@/lib/password",
    "app",
    "components",
  ])
    .split("\n")
    .filter(Boolean);

  assert.ok(owners.length > 0, "no files import the password policy — grep is wrong");

  const offenders: string[] = [];
  for (const file of owners) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // `.length > 0` is an emptiness check, not a policy threshold — a
        // minimum is never zero, and flagging those would bury the real one.
        if (/minLength=\{\d+\}|\.length\s*[<>]=?\s*(?!0\b)\d+/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `hardcoded password length — use PASSWORD_MIN_LENGTH:\n${offenders.join("\n")}`,
  );
});
