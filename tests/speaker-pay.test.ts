import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPEAKER_REVENUE_SHARE,
  speakerIsPaid,
  speakerShareCents,
} from "../lib/revenue";

/*
 * Two flags decide whether a speaker is on the 15% revenue share, and they
 * are set by different people for different reasons: tsls_main_speaker comes
 * from the TSLS lineup (mainstage speakers are unpaid on Momentum+),
 * payment_access is an admin's per-speaker switch (migration 0082). The
 * money shows only when both agree, and the pair can never contradict —
 * either one saying "no" is a no.
 */

test("speakerIsPaid: paid only with payment access and not a TSLS Main Speaker", () => {
  assert.equal(
    speakerIsPaid({ tslsMainSpeaker: false, paymentAccess: true }),
    true,
  );
  assert.equal(
    speakerIsPaid({ tslsMainSpeaker: false, paymentAccess: false }),
    false,
  );
  // TSLS Main Speaker is unpaid whether or not payment access is on, so the
  // two flags overlap without ever disagreeing about the outcome.
  assert.equal(
    speakerIsPaid({ tslsMainSpeaker: true, paymentAccess: true }),
    false,
  );
  assert.equal(
    speakerIsPaid({ tslsMainSpeaker: true, paymentAccess: false }),
    false,
  );
});

/*
 * The column defaults to true and every reader coerces with `!== false`, so
 * a row from a database that hasn't run 0082 (or a null slipped in by hand)
 * keeps the payment feature rather than silently losing it.
 */
test("payment access: only an explicit false takes the feature away", () => {
  const rows: { payment_access?: boolean | null }[] = [
    {},
    { payment_access: null },
    { payment_access: true },
  ];
  for (const row of rows) {
    assert.equal(
      speakerIsPaid({
        tslsMainSpeaker: false,
        paymentAccess: row.payment_access !== false,
      }),
      true,
    );
  }
  const off: { payment_access?: boolean | null } = { payment_access: false };
  assert.equal(
    speakerIsPaid({
      tslsMainSpeaker: false,
      paymentAccess: off.payment_access !== false,
    }),
    false,
  );
});

/*
 * §14 gives a featured month ONE 15% share. Two Advisors on the same month
 * split it; they do not each earn 15%, which is what this used to compute.
 *
 * The denominator is payable speakers only. Matt, 2026-08-11, on the two
 * speakers who prompted this: they are working together and will split any
 * payment, but they are TSLS Main Speakers and take no Momentum+ payment at
 * all — so an unpaid speaker must never dilute a paid one's share.
 */
test("speakerShareCents: one month, one 15% share, split evenly", () => {
  const revenue = 100_000; // $1,000.00
  const full = Math.round(revenue * SPEAKER_REVENUE_SHARE);
  assert.equal(full, 15_000);

  // Sole speaker: the whole share.
  assert.equal(speakerShareCents(revenue, 1), full);

  // Two payable speakers: half each, and the halves total the one share.
  const half = speakerShareCents(revenue, 2);
  assert.equal(half, 7_500);
  assert.equal(half * 2, full);

  // Three: a third each, never three times the share.
  assert.equal(speakerShareCents(revenue, 3), 5_000);
  assert.ok(speakerShareCents(revenue, 3) * 3 <= full + 3);
});

test("speakerShareCents: an empty or absent count never inflates the share", () => {
  const revenue = 100_000;
  const full = Math.round(revenue * SPEAKER_REVENUE_SHARE);
  // 0 payable speakers can only mean the count came back empty; a paid
  // speaker is always one of the sharers. Must not divide by zero or pay
  // more than the single share.
  assert.equal(speakerShareCents(revenue, 0), full);
  assert.ok(Number.isFinite(speakerShareCents(revenue, 0)));
  assert.equal(speakerShareCents(revenue, -1), full);
});

test("speakerShareCents: unpaid speakers are not in the denominator", () => {
  const revenue = 100_000;
  const full = Math.round(revenue * SPEAKER_REVENUE_SHARE);

  // The month that prompted this: one payable Advisor alongside TSLS Main
  // Speakers. Only payable speakers are counted, so the count is 1 and the
  // Advisor keeps the whole share.
  const payable = [
    { tslsMainSpeaker: false, paymentAccess: true },
    { tslsMainSpeaker: true, paymentAccess: true }, // Main Speaker: unpaid
    { tslsMainSpeaker: true, paymentAccess: true }, // Main Speaker: unpaid
    { tslsMainSpeaker: false, paymentAccess: false }, // access switched off
  ].filter(speakerIsPaid).length;

  assert.equal(payable, 1);
  assert.equal(speakerShareCents(revenue, payable), full);
});

test("speakerShareCents: rounding a shared odd pool stays within a cent", () => {
  // An odd share pool cannot halve exactly; each speaker rounds, so the two
  // may sum to one cent over. Pinned so the drift can't silently widen.
  const revenue = 33_333; // 15% = 4999.95 -> 5000
  const full = Math.round(revenue * SPEAKER_REVENUE_SHARE);
  const each = speakerShareCents(revenue, 2);
  assert.ok(Math.abs(each * 2 - full) <= 1, `${each * 2} vs ${full}`);
});
