import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/*
 * The invariant that makes silencing the auth-js warning safe
 * (Matt, 2026-08-19 — "filter the warning in Vercel logs").
 *
 * auth-js logs "Using the user object as returned from
 * supabase.auth.getSession() could be insecure!" on essentially every
 * authenticated request. It is a false positive here — the warning is about
 * trusting a cookie-derived user for authorization, and nothing in this
 * codebase does that — so lib/supabase/config.ts switches it off at the
 * source rather than hiding the whole Warning level in Vercel's UI.
 *
 * That trade is only sound while the premise holds. If someone later adds a
 * getSession() call, the suppression would hide a warning that had become
 * true. So the premise is asserted here instead of assumed.
 */

/** Source lines with comments dropped — the strings below appear in prose. */
function codeLines(paths: string): string[] {
  // grep exits 1 on no matches, which execFileSync turns into a throw. No
  // matches is the PASSING state here, so it must not look like an error.
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", paths, "app", "lib", "components"],
      { encoding: "utf8" },
    );
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e;
    out = err.stdout ?? "";
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const body = line.slice(line.indexOf(":", line.indexOf(":") + 1) + 1).trim();
      return !body.startsWith("//") && !body.startsWith("*") && !body.startsWith("/*");
    });
}

test("no authorization decision reads a session-derived user", () => {
  /*
   * getUser() round-trips to the Auth server and validates the JWT.
   * getSession() reads the cookie and believes it. Every gate in the app —
   * middleware, getAuthUser, requireAdmin, requireRealAdmin, and every route
   * and server action — must use the first.
   */
  const hits = codeLines("\\.auth\\.getSession(");
  assert.deepEqual(
    hits,
    [],
    "auth.getSession() returns a user straight from the cookie. Use " +
      "auth.getUser(). This also invalidates the warning suppression in " +
      "lib/supabase/config.ts, which assumes no call site does this.",
  );
});

test("both server client factories suppress the warning", () => {
  // Missing it on either one puts the noise back: createClient() covers
  // pages, actions and routes; the middleware client runs on every request.
  for (const path of ["lib/supabase/server.ts", "lib/supabase/middleware.ts"]) {
    assert.match(
      readFileSync(path, "utf8"),
      /suppressInsecureUserWarning\(/,
      `${path} creates a server client without suppressing the warning`,
    );
  }
});

test("the suppression explains itself and stays server-only", () => {
  const src = readFileSync("lib/supabase/config.ts", "utf8");
  // Browser clients never trip the proxy — it is installed only when
  // storage.isServer — so applying it there would be cargo cult.
  assert.doesNotMatch(readFileSync("lib/supabase/client.ts", "utf8"), /suppress/i);
  // The cast reaches a `protected` field. If that is ever done silently,
  // the next reader has no way to judge whether it is safe.
  assert.match(src, /tests\/supabase-auth\.test\.ts/);
});
