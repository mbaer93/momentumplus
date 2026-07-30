import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invoiceSubscriptionId,
  mapStatus,
  periodEndIso,
} from "../lib/stripe-events";

/*
 * The Stripe webhook decides who keeps paid access. Nothing here talked to a
 * test before — the helpers lived inside the route module, which can't be
 * imported without Next's server runtime.
 *
 * These cases are the ones where being wrong costs money in one direction or
 * the other: a paying member locked out, or a failed card left with access.
 */

test("active and trialing are the only statuses that grant access", () => {
  assert.equal(mapStatus("active"), "active");
  assert.equal(mapStatus("trialing"), "active");
});

test("a cancelled subscription is cancelled, not merely late", () => {
  // Distinct from past_due: cancelled keeps access to the end of the paid
  // period, past_due gets the 7-day grace. Collapsing them changes billing.
  assert.equal(mapStatus("canceled"), "canceled");
  assert.equal(mapStatus("incomplete_expired"), "canceled");
});

test("incomplete grants nothing — checkout hasn't settled its first payment", () => {
  // Mapping incomplete to past_due used to enroll a perfectly fine card in
  // the dunning sequence AND hand out the grace window pre-payment.
  assert.equal(mapStatus("incomplete"), "canceled");
});

test("everything else degrades to past_due, including statuses Stripe hasn't invented yet", () => {
  for (const s of ["past_due", "unpaid", "paused"]) {
    assert.equal(mapStatus(s), "past_due", s);
  }
  // The important half: an unknown status is not evidence of payment, so it
  // must not fall through to "active". It also must not hard-cancel someone
  // over a status we simply don't recognise yet.
  assert.equal(mapStatus("some_future_status"), "past_due");
  assert.equal(mapStatus(""), "past_due");
});

test("period end is read from the subscription or from its first item", () => {
  // Stripe's 2025 "Basil" versions moved current_period_end onto the item;
  // older versions keep it top-level. The endpoint pins no api_version, so
  // both shapes arrive in production.
  const unix = 1_800_000_000;
  const iso = new Date(unix * 1000).toISOString();
  assert.equal(periodEndIso({ current_period_end: unix }), iso);
  assert.equal(periodEndIso({ items: { data: [{ current_period_end: unix }] } }), iso);
});

test("a subscription carrying no period end yields null rather than an epoch date", () => {
  // A falsy unix timestamp must not become 1970-01-01 — that would read as
  // "expired long ago" and cut off a paying member.
  assert.equal(periodEndIso({}), null);
  assert.equal(periodEndIso({ items: { data: [] } }), null);
  assert.equal(periodEndIso({ current_period_end: 0 }), null);
});

test("top-level period end wins over the item copy when both are present", () => {
  const top = 1_800_000_000;
  const item = 1_700_000_000;
  assert.equal(
    periodEndIso({ current_period_end: top, items: { data: [{ current_period_end: item }] } }),
    new Date(top * 1000).toISOString(),
  );
});

test("an invoice's subscription id is found in either API shape", () => {
  assert.equal(invoiceSubscriptionId({ subscription: "sub_123" }), "sub_123");
  assert.equal(
    invoiceSubscriptionId({
      parent: { subscription_details: { subscription: "sub_456" } },
    }),
    "sub_456",
  );
});

test("a one-off invoice with no subscription is null, not a truthy stub", () => {
  // invoice.paid fires for one-off charges too. Returning something
  // non-null here would send the handler looking up a subscription that
  // doesn't exist.
  assert.equal(invoiceSubscriptionId({}), null);
  assert.equal(invoiceSubscriptionId({ subscription: null }), null);
  assert.equal(invoiceSubscriptionId({ subscription: "" }), null);
  assert.equal(invoiceSubscriptionId({ parent: null }), null);
  assert.equal(
    invoiceSubscriptionId({ parent: { subscription_details: null } }),
    null,
  );
});
