import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  applyGhlEvent,
  effectiveMembership,
  GRACE_DAYS,
  hasAccess,
  mapTslsRegistration,
  normalizeGhlEvent,
  resolveTier,
  tierDurationMonths,
} from "../lib/membership";
import type { GhlEvent } from "../lib/membership";

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0); // Jul 14 2026 12:00Z
const DAY = 24 * 60 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// --- addMonths --------------------------------------------------------------

test("addMonths clamps end-of-month overflow", () => {
  assert.equal(
    addMonths(new Date(Date.UTC(2026, 0, 31)), 1).toISOString(),
    new Date(Date.UTC(2026, 1, 28)).toISOString(), // Jan 31 → Feb 28
  );
  assert.equal(
    addMonths(new Date(Date.UTC(2026, 2, 15)), 12).toISOString(),
    new Date(Date.UTC(2027, 2, 15)).toISOString(),
  );
});

test("tier durations match SPEC §2", () => {
  assert.equal(tierDurationMonths("sub_monthly"), 1);
  assert.equal(tierDurationMonths("sub_3mo"), 3);
  assert.equal(tierDurationMonths("sub_6mo"), 6);
  assert.equal(tierDurationMonths("sub_annual"), 12);
  assert.equal(tierDurationMonths("tsls_vip"), 3);
  assert.equal(tierDurationMonths("speaker"), null);
});

// --- hasAccess / effectiveMembership ----------------------------------------

test("hasAccess: grace semantics for past_due and canceled", () => {
  const future = iso(NOW + 3 * DAY);
  const past = iso(NOW - DAY);
  assert.equal(hasAccess({ status: "active", access_expires_at: future }, NOW), true);
  assert.equal(hasAccess({ status: "active", access_expires_at: null }, NOW), true);
  assert.equal(hasAccess({ status: "past_due", access_expires_at: future }, NOW), true);
  assert.equal(hasAccess({ status: "past_due", access_expires_at: past }, NOW), false);
  assert.equal(hasAccess({ status: "canceled", access_expires_at: future }, NOW), true);
  assert.equal(hasAccess({ status: "canceled", access_expires_at: null }, NOW), false);
  assert.equal(hasAccess({ status: "expired", access_expires_at: future }, NOW), false);
});

test("effectiveMembership picks the most privileged usable row", () => {
  const rows = [
    { tier: "tsls_attendee", status: "active", access_expires_at: iso(NOW + DAY) },
    { tier: "sub_annual", status: "active", access_expires_at: iso(NOW + 300 * DAY) },
    { tier: "admin", status: "expired", access_expires_at: iso(NOW - DAY) },
  ] as const;
  assert.equal(effectiveMembership([...rows], NOW)?.tier, "sub_annual");
  assert.equal(effectiveMembership([], NOW), null);
});

// --- normalize / resolve -----------------------------------------------------

test("normalizeGhlEvent accepts our contract and GHL-style aliases", () => {
  const a = normalizeGhlEvent({
    type: "payment_success",
    contactId: "c1",
    email: "A@B.com",
    productId: "prod_1",
  });
  assert.equal(a?.kind, "payment_success");
  assert.equal(a?.email, "a@b.com");

  const b = normalizeGhlEvent({
    event: "InvoicePaid",
    contact_id: "c2",
    email: "x@y.com",
  });
  assert.equal(b?.kind, "payment_success");

  const c = normalizeGhlEvent({
    type: "subscription_cancelled",
    contactId: "c3",
    email: "x@y.com",
  });
  assert.equal(c?.kind, "cancel");

  assert.equal(normalizeGhlEvent({ type: "something_else", email: "x@y.com" }), null);
  assert.equal(normalizeGhlEvent({ type: "payment_success" }), null); // no email
});

test("resolveTier maps product ids via the env JSON map", () => {
  const map = JSON.stringify({ prod_m: "sub_monthly", prod_a: "sub_annual" });
  assert.equal(resolveTier({ productId: "prod_a" }, map), "sub_annual");
  assert.equal(resolveTier({ productId: "nope" }, map), null);
  assert.equal(resolveTier({ tier: "sub_3mo" }, undefined), "sub_3mo");
  assert.equal(resolveTier({ productId: "prod_a" }, "not-json"), null);
});

// --- applyGhlEvent -----------------------------------------------------------

const successEvent: GhlEvent = {
  kind: "payment_success",
  contactId: "c1",
  email: "m@x.com",
};

test("payment_success on a new member starts now + duration", () => {
  const patch = applyGhlEvent(successEvent, "sub_annual", null, NOW);
  assert.equal(patch.status, "active");
  assert.equal(patch.access_starts_at, iso(NOW));
  assert.equal(
    patch.access_expires_at,
    addMonths(new Date(NOW), 12).toISOString(),
  );
  assert.equal(patch.ghl_contact_id, "c1");
});

test("payment_success extends from current expiry when still active (rolling monthly)", () => {
  const existing = {
    tier: "sub_monthly",
    status: "active",
    access_starts_at: iso(NOW - 30 * DAY),
    access_expires_at: iso(NOW + 5 * DAY),
  } as const;
  const patch = applyGhlEvent(successEvent, "sub_monthly", { ...existing }, NOW);
  assert.equal(
    patch.access_expires_at,
    addMonths(new Date(NOW + 5 * DAY), 1).toISOString(),
  );
});

test("payment_success after a lapse restarts from now", () => {
  const existing = {
    tier: "sub_monthly",
    status: "expired",
    access_starts_at: iso(NOW - 90 * DAY),
    access_expires_at: iso(NOW - 30 * DAY),
  } as const;
  const patch = applyGhlEvent(successEvent, "sub_monthly", { ...existing }, NOW);
  assert.equal(patch.status, "active");
  assert.equal(
    patch.access_expires_at,
    addMonths(new Date(NOW), 1).toISOString(),
  );
});

test("payment_failed grants a 7-day grace but never shortens a paid period", () => {
  const failed: GhlEvent = { ...successEvent, kind: "payment_failed" };

  const nearExpiry = applyGhlEvent(
    failed,
    "sub_monthly",
    {
      tier: "sub_monthly",
      status: "active",
      access_starts_at: iso(NOW - 30 * DAY),
      access_expires_at: iso(NOW + DAY),
    },
    NOW,
  );
  assert.equal(nearExpiry.status, "past_due");
  assert.equal(nearExpiry.access_expires_at, iso(NOW + GRACE_DAYS * DAY));

  const longRunway = applyGhlEvent(
    failed,
    "sub_annual",
    {
      tier: "sub_annual",
      status: "active",
      access_starts_at: iso(NOW - 30 * DAY),
      access_expires_at: iso(NOW + 200 * DAY),
    },
    NOW,
  );
  assert.equal(longRunway.access_expires_at, iso(NOW + 200 * DAY));
});

test("cancel keeps access until period end and preserves tier", () => {
  const cancel: GhlEvent = { ...successEvent, kind: "cancel" };
  const patch = applyGhlEvent(
    cancel,
    "sub_monthly",
    {
      tier: "sub_annual",
      status: "active",
      access_starts_at: iso(NOW - 100 * DAY),
      access_expires_at: iso(NOW + 260 * DAY),
    },
    NOW,
  );
  assert.equal(patch.status, "canceled");
  assert.equal(patch.tier, "sub_annual");
  assert.equal(patch.access_expires_at, iso(NOW + 260 * DAY));
});

// --- TSLS mapping ------------------------------------------------------------

test("mapTslsRegistration: VIP is spec-fixed, others need the config map", () => {
  assert.deepEqual(mapTslsRegistration("VIP", undefined), {
    tier: "tsls_vip",
    months: 3,
  });
  assert.deepEqual(mapTslsRegistration("VIP Summit Pass", undefined), {
    tier: "tsls_vip",
    months: 3,
  });
  // Unmapped non-VIP types are skipped, not guessed.
  assert.equal(mapTslsRegistration("General Admission", undefined), null);

  const map = JSON.stringify({
    "general admission": { tier: "tsls_attendee", months: 2 },
  });
  assert.deepEqual(mapTslsRegistration("General Admission", map), {
    tier: "tsls_attendee",
    months: 2,
  });
  // Config wins over the VIP keyword default when both could match.
  const vipOverride = JSON.stringify({ vip: { tier: "tsls_vip", months: 6 } });
  assert.deepEqual(mapTslsRegistration("vip", vipOverride), {
    tier: "tsls_vip",
    months: 6,
  });
});
