import { test } from "node:test";
import assert from "node:assert/strict";
import {
  giftExtendedExpiry,
  giftPlanFor,
  isFutureStart,
  isGiftTier,
  isPaidTier,
  parseGiftStart,
  pauseResumesAtUnix,
  type BilledRow,
} from "../lib/gifts";

/*
 * TSLS gift decisions: what a 1/3-month attendee gift does to an existing
 * account — pause Stripe billing, extend a non-Stripe membership, or just
 * grant the normal gift row.
 */

const NOW = new Date("2026-10-14T17:00:00Z").getTime();

function row(overrides: Partial<BilledRow>): BilledRow {
  return {
    id: "m1",
    tier: "basic",
    status: "active",
    access_expires_at: "2026-11-01T00:00:00Z",
    source: "stripe",
    stripe_subscription_id: "sub_123",
    ...overrides,
  };
}

test("tier classifiers split gifts from paid plans", () => {
  assert.equal(isGiftTier("gift"), true);
  assert.equal(isGiftTier("vip"), true);
  assert.equal(isGiftTier("tsls_vip"), true);
  assert.equal(isGiftTier("pro"), false);
  assert.equal(isPaidTier("pro"), true);
  assert.equal(isPaidTier("sub_annual"), true);
  assert.equal(isPaidTier("speaker"), false);
});

test("no memberships → normal grant", () => {
  assert.deepEqual(giftPlanFor([], NOW), { kind: "grant" });
});

test("free/comp rows → normal grant", () => {
  const rows = [
    row({ tier: "speaker", source: "admin", stripe_subscription_id: null, access_expires_at: null }),
    row({ tier: "gift", source: "zapier", stripe_subscription_id: null }),
  ];
  assert.deepEqual(giftPlanFor(rows, NOW), { kind: "grant" });
});

test("active Stripe-billed member → pause", () => {
  const plan = giftPlanFor([row({})], NOW);
  assert.equal(plan.kind, "pause");
});

test("active GHL-billed member → extend", () => {
  const plan = giftPlanFor(
    [row({ tier: "sub_monthly", source: "ghl", stripe_subscription_id: null })],
    NOW,
  );
  assert.equal(plan.kind, "extend");
});

test("past_due and canceled members are not billing-paused", () => {
  assert.deepEqual(giftPlanFor([row({ status: "past_due" })], NOW), {
    kind: "grant",
  });
  assert.deepEqual(giftPlanFor([row({ status: "canceled" })], NOW), {
    kind: "grant",
  });
});

test("an expired 'active' row does not count as paying", () => {
  const plan = giftPlanFor(
    [row({ access_expires_at: "2026-01-01T00:00:00Z" })],
    NOW,
  );
  assert.deepEqual(plan, { kind: "grant" });
});

test("a Stripe row wins over a GHL row even at lower precedence", () => {
  const ghlPro = row({
    id: "ghl",
    tier: "pro",
    source: "ghl",
    stripe_subscription_id: null,
  });
  const stripeBasic = row({ id: "str", tier: "basic" });
  const plan = giftPlanFor([ghlPro, stripeBasic], NOW);
  assert.equal(plan.kind, "pause");
  assert.equal((plan as { row: BilledRow }).row.id, "str");
});

test("giftExtendedExpiry stacks onto a still-valid expiry", () => {
  const out = giftExtendedExpiry("2026-11-01T00:00:00.000Z", 1, NOW);
  assert.equal(out, "2026-12-01T00:00:00.000Z");
});

test("giftExtendedExpiry restarts from now when lapsed or open-ended", () => {
  const fromLapsed = giftExtendedExpiry("2026-01-01T00:00:00.000Z", 3, NOW);
  assert.equal(fromLapsed, new Date("2027-01-14T17:00:00.000Z").toISOString());
  const fromNull = giftExtendedExpiry(null, 1, NOW);
  assert.equal(fromNull, new Date("2026-11-14T17:00:00.000Z").toISOString());
});

test("parseGiftStart accepts ISO dates and rejects junk", () => {
  assert.equal(
    parseGiftStart("2026-10-01T00:00:00-04:00"),
    "2026-10-01T04:00:00.000Z",
  );
  assert.equal(parseGiftStart("not-a-date"), null);
  assert.equal(parseGiftStart(""), null);
  assert.equal(parseGiftStart(undefined), null);
  assert.equal(parseGiftStart(20261001), null);
});

test("isFutureStart schedules only genuinely future dates", () => {
  assert.equal(isFutureStart("2026-10-01T04:00:00.000Z", NOW), false); // past
  assert.equal(isFutureStart("2026-10-14T17:00:01.000Z", NOW), true);
  assert.equal(isFutureStart(null, NOW), false);
});

test("pauseResumesAtUnix is the gift months from now, in seconds", () => {
  assert.equal(
    pauseResumesAtUnix(3, NOW),
    Math.floor(new Date("2027-01-14T17:00:00Z").getTime() / 1000),
  );
});
