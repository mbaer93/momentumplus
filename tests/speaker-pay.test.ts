import { test } from "node:test";
import assert from "node:assert/strict";
import { speakerIsPaid } from "../lib/revenue";

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
