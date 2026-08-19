import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  RESEND_EVENT_MAP,
  SVIX_TOLERANCE_MS,
  resendEventRows,
  verifySvixSignature,
} from "../lib/resend-webhook";

/*
 * The Resend webhook (Phase 8).
 *
 * It fails quietly in two opposite directions, and neither looks like an
 * error. Too loose, and anyone can POST a forged "bounced" event — which
 * emails every Super Admin. Too strict, and every real event is rejected:
 * the symptom is an Email Delivery page that stays empty, which reads as
 * "no problems" rather than "no data". This is also the path that told Matt
 * about the reviewer@thetslsapp.com bounce, so it is load-bearing for
 * knowing whether invites are landing at all.
 */

const SECRET = "whsec_" + Buffer.from("a-test-signing-secret").toString("base64");
const NOW = Date.parse("2026-08-19T04:00:00Z");
const TS = String(Math.floor(NOW / 1000));
const ID = "msg_2abc";

function sign(body: string, id = ID, ts = TS, secret = SECRET): string {
  const key = Buffer.from(secret.slice(6), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return `v1,${mac.toString("base64")}`;
}

const BODY = JSON.stringify({
  type: "email.bounced",
  created_at: "2026-08-19T03:59:00.000Z",
  data: { to: "reviewer@thetslsapp.com", bounce: { message: "Mailbox not found" } },
});

test("a correctly signed request verifies", () => {
  assert.equal(
    verifySvixSignature(
      { id: ID, timestamp: TS, signature: sign(BODY) },
      BODY,
      SECRET,
      NOW,
    ),
    true,
  );
});

test("the secret is accepted with or without its whsec_ prefix", () => {
  // Resend shows it prefixed; someone pasting into an env var may strip it.
  const bare = SECRET.slice(6);
  assert.equal(
    verifySvixSignature(
      { id: ID, timestamp: TS, signature: sign(BODY) },
      BODY,
      bare,
      NOW,
    ),
    true,
  );
});

test("a tampered body does not verify", () => {
  const signature = sign(BODY);
  const tampered = BODY.replace("Mailbox not found", "Everything is fine");
  assert.equal(
    verifySvixSignature({ id: ID, timestamp: TS, signature }, tampered, SECRET, NOW),
    false,
  );
});

test("a signature from a different secret does not verify", () => {
  const other = "whsec_" + Buffer.from("someone-elses-secret").toString("base64");
  assert.equal(
    verifySvixSignature(
      { id: ID, timestamp: TS, signature: sign(BODY, ID, TS, other) },
      BODY,
      SECRET,
      NOW,
    ),
    false,
  );
});

test("a replayed request is rejected once it is stale", () => {
  // Without this, a captured request stays valid forever.
  const old = String(Math.floor((NOW - SVIX_TOLERANCE_MS - 1000) / 1000));
  assert.equal(
    verifySvixSignature(
      { id: ID, timestamp: old, signature: sign(BODY, ID, old) },
      BODY,
      SECRET,
      NOW,
    ),
    false,
  );
  // Inside the window it still verifies.
  const recent = String(Math.floor((NOW - 60_000) / 1000));
  assert.equal(
    verifySvixSignature(
      { id: ID, timestamp: recent, signature: sign(BODY, ID, recent) },
      BODY,
      SECRET,
      NOW,
    ),
    true,
  );
});

test("missing headers, no secret, and junk signatures all fail closed", () => {
  const sig = sign(BODY);
  assert.equal(verifySvixSignature({ id: null, timestamp: TS, signature: sig }, BODY, SECRET, NOW), false);
  assert.equal(verifySvixSignature({ id: ID, timestamp: null, signature: sig }, BODY, SECRET, NOW), false);
  assert.equal(verifySvixSignature({ id: ID, timestamp: TS, signature: null }, BODY, SECRET, NOW), false);
  assert.equal(verifySvixSignature({ id: ID, timestamp: TS, signature: sig }, BODY, undefined, NOW), false);
  // A malformed signature must be a 401, not a 500 — timingSafeEqual throws
  // on a length mismatch, so the length is checked first.
  assert.equal(verifySvixSignature({ id: ID, timestamp: TS, signature: "v1,zzz" }, BODY, SECRET, NOW), false);
  assert.equal(verifySvixSignature({ id: ID, timestamp: TS, signature: "garbage" }, BODY, SECRET, NOW), false);
  assert.equal(verifySvixSignature({ id: ID, timestamp: "not-a-number", signature: sig }, BODY, SECRET, NOW), false);
});

test("a rotating secret sends several candidates and one is enough", () => {
  const stale = "v1," + Buffer.from("nope").toString("base64");
  const combined = `${stale} ${sign(BODY)}`;
  assert.equal(
    verifySvixSignature({ id: ID, timestamp: TS, signature: combined }, BODY, SECRET, NOW),
    true,
  );
});

// --- payload → journal rows -------------------------------------------------

test("every Resend event we subscribe to maps to a normalized one", () => {
  // The setup comment in the route names these five as the events to
  // enable; a missing entry means those are silently dropped.
  for (const type of [
    "email.delivered",
    "email.opened",
    "email.bounced",
    "email.complained",
    "email.failed",
  ]) {
    assert.ok(RESEND_EVENT_MAP[type], `${type} has no mapping`);
  }
});

test("an unknown event type is ignored, not journaled", () => {
  assert.equal(resendEventRows({ type: "email.something_new" }), null);
  assert.equal(resendEventRows({}), null);
});

test("a bounce becomes one row carrying the reason", () => {
  const rows = resendEventRows(JSON.parse(BODY));
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].email, "reviewer@thetslsapp.com");
  assert.equal(rows?.[0].event, "bounce");
  assert.equal(rows?.[0].reason, "Mailbox not found");
  assert.equal(rows?.[0].occurred_at, "2026-08-19T03:59:00.000Z");
});

test("one event to several recipients becomes several rows", () => {
  // Otherwise a bounce to two addresses is journaled as one and alerts once.
  const rows = resendEventRows({
    type: "email.bounced",
    data: { to: ["a@example.com", "b@example.com"] },
  });
  assert.equal(rows?.length, 2);
  assert.deepEqual(rows?.map((r) => r.email), ["a@example.com", "b@example.com"]);
});

test("the reason falls back through bounce, failure, then subType", () => {
  assert.equal(
    resendEventRows({ type: "email.failed", data: { to: "x@y.z", failed: { reason: "SMTP 550" } } })?.[0].reason,
    "SMTP 550",
  );
  assert.equal(
    resendEventRows({ type: "email.bounced", data: { to: "x@y.z", bounce: { subType: "Suppressed" } } })?.[0].reason,
    "Suppressed",
  );
  // No reason at all is null, not an empty string — the column reads as
  // "none given" rather than "given, and blank".
  assert.equal(
    resendEventRows({ type: "email.delivered", data: { to: "x@y.z" } })?.[0].reason,
    null,
  );
});

test("outside strings are capped before they reach the table or an alert", () => {
  const long = `${"a".repeat(400)}@example.com`;
  const rows = resendEventRows({
    type: "email.bounced",
    data: { to: long, bounce: { message: "b".repeat(400) } },
  });
  assert.equal(rows?.[0].email.length, 200);
  assert.equal(rows?.[0].reason?.length, 200);
});

test("a missing timestamp falls back to now rather than an invalid date", () => {
  const rows = resendEventRows({ type: "email.delivered", data: { to: "x@y.z" } }, "2026-08-19T04:00:00.000Z");
  assert.equal(rows?.[0].occurred_at, "2026-08-19T04:00:00.000Z");
});

test("an event with no recipient is still journaled", () => {
  // Losing a bounce because the payload shape surprised us is worse than a
  // row that says "unknown".
  const rows = resendEventRows({ type: "email.bounced" });
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].email, "unknown");
});
