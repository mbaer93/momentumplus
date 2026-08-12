import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/*
 * Referrals must never spend money (Matt, 2026-08-12: "there should be no
 * real money being paid out to referrals").
 *
 * There was a payout here once — a Stripe balance credit for one month of
 * the referrer's own plan, or a month added to a comped member's
 * access_expires_at. It never paid anybody, only because production happens
 * to lack the referrals table and profiles.referral_code, so attribution
 * returned before reaching it. The code shipped in every deploy regardless,
 * so any future schema sync would have armed it silently.
 *
 * Deleting it is not enough on its own: the next person to want a referral
 * reward will reach for this file, and the change would look reasonable in
 * review. This scan is what makes reintroducing it a deliberate act — you
 * have to delete this test too, and that is a conversation.
 *
 * If a reward IS wanted one day, agree the pricing first, then change this
 * test in the same commit that builds it.
 */

const SOURCE = readFileSync("lib/referrals.ts", "utf8");

test("referrals never move money or extend access", () => {
  // Spending paths, by the API they would have to reach for.
  const forbidden: [RegExp, string][] = [
    [/balance_transactions/, "Stripe customer balance credit"],
    [/stripeRequest/, "a direct Stripe API call"],
    [/@\/lib\/stripe/, "an import of the Stripe helper"],
    [/access_expires_at['"]?\s*:/, "a write to access_expires_at"],
    // `[^}]` already crosses newlines, so this needs no dotAll flag — which
    // the build's target does not allow anyway.
    [/\.update\(\s*\{[^}]*access_expires_at/, "extending a membership"],
    [/coupon|credit_note|refund/i, "a Stripe discount or refund"],
  ];
  for (const [pattern, what] of forbidden) {
    assert.ok(
      !pattern.test(SOURCE),
      `lib/referrals.ts reintroduced ${what}. Referrals are bookkeeping only — ` +
        "a reward is a pricing decision to agree with Matt first.",
    );
  }
});

test("the referrer is never promised a reward", () => {
  // A message implying a credit that never arrives is its own bug.
  for (const claim of [
    /free month/i,
    /earned/i,
    /credit(ed)? (for|to)/i,
    /extended by/i,
  ]) {
    assert.ok(
      !claim.test(SOURCE),
      `lib/referrals.ts promises the referrer something (${claim}). ` +
        "Attribution is recorded; nothing is owed.",
    );
  }
});

test("attribution itself still works — this is not a feature deletion", () => {
  // The guard must not be satisfiable by gutting referrals entirely.
  assert.match(SOURCE, /export async function attributeReferral/);
  assert.match(SOURCE, /export async function ensureReferralCode/);
  assert.match(SOURCE, /from\("referrals"\)\s*\.insert/);
});
