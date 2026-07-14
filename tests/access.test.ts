import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccess, isVipPlus, isMembershipActive } from "../lib/access";
import type { Membership } from "../lib/types";

test("canAccess: all_members is open to any tier", () => {
  assert.equal(canAccess("tsls_attendee", "all_members"), true);
  assert.equal(canAccess("sub_monthly", "all_members"), true);
});

test("canAccess: vip_plus gate", () => {
  assert.equal(canAccess("sub_annual", "vip_plus"), true);
  assert.equal(canAccess("tsls_vip", "vip_plus"), true);
  assert.equal(canAccess("speaker", "vip_plus"), true);
  assert.equal(canAccess("admin", "vip_plus"), true);
  assert.equal(canAccess("sub_monthly", "vip_plus"), false);
  assert.equal(canAccess("tsls_attendee", "vip_plus"), false);
});

test("canAccess: admin_only", () => {
  assert.equal(canAccess("admin", "admin_only"), true);
  assert.equal(canAccess("sub_annual", "admin_only"), false);
});

test("isVipPlus matches the documented tier set", () => {
  assert.equal(isVipPlus("sub_annual"), true);
  assert.equal(isVipPlus("sub_6mo"), false);
});

test("isMembershipActive respects status and expiry", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const make = (over: Partial<Membership>): Membership => ({
    id: "m",
    profile_id: "p",
    tier: "sub_annual",
    status: "active",
    access_starts_at: null,
    access_expires_at: future,
    ghl_contact_id: null,
    source: "ghl",
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  assert.equal(isMembershipActive(make({})), true);
  assert.equal(isMembershipActive(make({ status: "canceled" })), false);
  assert.equal(isMembershipActive(make({ access_expires_at: past })), false);
  assert.equal(
    isMembershipActive(make({ tier: "speaker", access_expires_at: null })),
    true,
  );
  assert.equal(isMembershipActive(null), false);
});
