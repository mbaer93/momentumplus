import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Two-factor on admin accounts (Matt, 2026-08-19).
 *
 * The behaviour itself belongs to Supabase, so what is worth pinning is the
 * WIRING — the four places where getting it slightly wrong produces a gate
 * that looks present and isn't, or one that locks the only admin out of the
 * page they would use to fix it.
 */

const read = (p: string) => readFileSync(p, "utf8");

test("the gate keys off mustVerify, not a role", () => {
  /*
   * If it keyed off "is a Super Admin", every admin would be locked out the
   * moment the code shipped, because none of them has enrolled yet. Keying
   * off a VERIFIED factor means enrolment can come first and enforcement
   * follows from it.
   */
  const mfa = read("lib/mfa.ts");
  assert.match(mfa, /mustVerify:\s*next === "aal2" && current === "aal1"/);
});

test("server actions enforce it, not only the page layout", () => {
  /*
   * The layout gates what an admin can SEE. Every action re-checks
   * independently — so without this, a tab opened before enrolment could
   * still mint a sign-in link or delete an account.
   */
  const helpers = read("lib/auth-helpers.ts");
  assert.match(helpers, /mfaStatus/);
  assert.match(helpers, /mustVerify/);
  // And it sits AFTER the admin check, so a non-admin still gets 403 rather
  // than being told to enter a code they do not have.
  assert.ok(
    helpers.indexOf("Admin access required.") < helpers.indexOf("mustVerify"),
  );
});

test("the break-glass console is gated too", () => {
  /*
   * /rescue is Super-Admin-only and deliberately outside the portal layout,
   * which is exactly what would make it the way around MFA if it were
   * exempt.
   */
  const rescue = read("app/rescue/page.tsx");
  assert.match(rescue, /mfaStatus/);
  assert.match(rescue, /\/verify\?redirect=\/rescue/);
});

test("the verify page is not inside the gate it satisfies", () => {
  /*
   * Under /admin the layout would redirect it to itself, and the only way
   * in would be to already be in.
   */
  const verify = read("app/(auth)/verify/page.tsx");
  assert.ok(verify.length > 0);
  // The admin layout redirects OUT to it, never to a path under /admin.
  const layout = read("app/(portal)/admin/layout.tsx");
  assert.match(layout, /redirect\("\/verify\?redirect=\/admin"\)/);
});

test("enrolment clears an abandoned factor before starting a new one", () => {
  // Supabase refuses a second factor with the same friendly name, so one
  // mistyped code would otherwise make the button permanently useless.
  const actions = read("app/(portal)/admin/security/actions.ts");
  assert.match(actions, /status === "unverified"/);
  assert.match(actions, /unenroll/);
});

test("turning two-factor OFF needs a current code", () => {
  // Otherwise a stolen session — the thing the factor exists to survive —
  // is enough to remove the factor.
  const actions = read("app/(portal)/admin/security/actions.ts");
  const disable = actions.slice(actions.indexOf("export async function disableMfa"));
  assert.match(disable, /challengeAndVerify/);
  assert.ok(
    disable.indexOf("challengeAndVerify") < disable.indexOf("unenroll"),
    "verify must happen before unenroll",
  );
});

test("the redirect back from verification cannot leave the site", () => {
  const actions = read("app/(auth)/verify/actions.ts");
  assert.match(actions, /startsWith\("\/"\) && !redirectTo\.startsWith\("\/\/"\)/);
});

test("the security card is not hidden by area permissions", () => {
  // A standard admin reaches member contact details too, and no permission
  // should be able to hide their own account security from them.
  const hub = read("app/(portal)/admin/page.tsx");
  assert.match(hub, /c\.area === undefined \|\| canAccessArea/);
  assert.match(hub, /\/admin\/security/);
});
