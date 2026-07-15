import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyStripeSignature } from "../lib/stripe";
import { planToTier } from "../lib/onboarding";
import { canAccess } from "../lib/access";

function sign(payload: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret)
    .update(`${t}.${payload}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ type: "checkout.session.completed" });
  const now = 1_800_000_000;

  it("accepts a correctly signed payload within tolerance", () => {
    const header = sign(payload, secret, now - 10);
    assert.equal(
      verifyStripeSignature(payload, header, secret, { nowSeconds: now }),
      true,
    );
  });

  it("rejects a wrong secret, tampered payload, and stale timestamp", () => {
    const header = sign(payload, secret, now);
    assert.equal(
      verifyStripeSignature(payload, header, "whsec_other", { nowSeconds: now }),
      false,
    );
    assert.equal(
      verifyStripeSignature(payload + "x", header, secret, { nowSeconds: now }),
      false,
    );
    const old = sign(payload, secret, now - 3600);
    assert.equal(
      verifyStripeSignature(payload, old, secret, { nowSeconds: now }),
      false,
    );
  });

  it("rejects missing or malformed headers", () => {
    assert.equal(verifyStripeSignature(payload, null, secret), false);
    assert.equal(verifyStripeSignature(payload, "t=,v1=", secret), false);
    assert.equal(verifyStripeSignature(payload, "nonsense", secret), false);
  });
});

describe("member levels (July 2026 rules)", () => {
  it("maps the four levels with their comp durations", () => {
    assert.deepEqual(planToTier("basic"), { tier: "basic", months: 1 });
    assert.deepEqual(planToTier("gift"), { tier: "gift", months: 1 });
    assert.deepEqual(planToTier("vip"), { tier: "vip", months: 3 });
    assert.deepEqual(planToTier("pro"), { tier: "pro", months: 1 });
  });

  it("gates pro_only content to Pro (and admin) only", () => {
    assert.equal(canAccess("pro", "pro_only"), true);
    assert.equal(canAccess("admin", "pro_only"), true);
    assert.equal(canAccess("basic", "pro_only"), false);
    assert.equal(canAccess("gift", "pro_only"), false);
    assert.equal(canAccess("vip", "pro_only"), false);
    assert.equal(canAccess("sub_annual", "pro_only"), false);
  });

  it("keeps gift/vip at Basic-level access, and pro clears vip_plus", () => {
    assert.equal(canAccess("gift", "all_members"), true);
    assert.equal(canAccess("vip", "all_members"), true);
    assert.equal(canAccess("vip", "vip_plus"), false);
    assert.equal(canAccess("pro", "vip_plus"), true);
  });
});
