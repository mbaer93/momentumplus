import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { verifyGhlWebhook } from "../lib/ghl";

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ type: "payment_success", email: "a@b.com" });

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("accepts a valid HMAC signature", () => {
  assert.equal(
    verifyGhlWebhook(BODY, { signature: sign(BODY, SECRET) }, SECRET),
    true,
  );
});

test("rejects a tampered body or wrong secret", () => {
  assert.equal(
    verifyGhlWebhook(BODY + " ", { signature: sign(BODY, SECRET) }, SECRET),
    false,
  );
  assert.equal(
    verifyGhlWebhook(BODY, { signature: sign(BODY, "other") }, SECRET),
    false,
  );
});

test("accepts the shared-secret header fallback, timing-safe", () => {
  assert.equal(verifyGhlWebhook(BODY, { sharedSecret: SECRET }, SECRET), true);
  assert.equal(verifyGhlWebhook(BODY, { sharedSecret: "nope" }, SECRET), false);
  assert.equal(
    verifyGhlWebhook(BODY, { sharedSecret: SECRET.slice(0, -1) }, SECRET),
    false,
  );
});

test("rejects everything when no secret is configured or headers missing", () => {
  assert.equal(
    verifyGhlWebhook(BODY, { signature: sign(BODY, SECRET) }, undefined),
    false,
  );
  assert.equal(verifyGhlWebhook(BODY, {}, SECRET), false);
});
