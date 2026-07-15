import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planToTier } from "../lib/onboarding";

describe("planToTier", () => {
  it("maps the four confirmed pricing plans", () => {
    assert.deepEqual(planToTier("monthly"), { tier: "sub_monthly", months: 1 });
    assert.deepEqual(planToTier("3month"), { tier: "sub_3mo", months: 3 });
    assert.deepEqual(planToTier("6month"), { tier: "sub_6mo", months: 6 });
    assert.deepEqual(planToTier("12month"), { tier: "sub_annual", months: 12 });
  });

  it("accepts common aliases, casing, and separators", () => {
    assert.deepEqual(planToTier("Annual"), { tier: "sub_annual", months: 12 });
    assert.deepEqual(planToTier("3 Month"), { tier: "sub_3mo", months: 3 });
    assert.deepEqual(planToTier("sub_6mo"), { tier: "sub_6mo", months: 6 });
    assert.deepEqual(planToTier("YEARLY"), { tier: "sub_annual", months: 12 });
    // "vip" now means the July 2026 member level (free Basic-level, 3 months);
    // the old TSLS VIP tier is reachable as "tslsvip".
    assert.deepEqual(planToTier("VIP"), { tier: "vip", months: 3 });
    assert.deepEqual(planToTier("tslsvip"), { tier: "tsls_vip", months: 12 });
    assert.deepEqual(planToTier("attendee"), {
      tier: "tsls_attendee",
      months: 12,
    });
  });

  it("gives speakers ongoing access (0 months → no expiry)", () => {
    assert.deepEqual(planToTier("speaker"), { tier: "speaker", months: 0 });
  });

  it("rejects unknown plans and never maps to admin", () => {
    assert.equal(planToTier("gold"), null);
    assert.equal(planToTier(""), null);
    assert.equal(planToTier("admin"), null);
  });
});
