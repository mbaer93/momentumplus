import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { badgeTag, verifyGhlWebhook } from "../lib/ghl";
import { selectableBadges } from "../lib/badges";

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

/*
 * Badge → GHL tag names (migration 0092).
 *
 * These strings become segments, workflows, and offers inside GHL. A change
 * to one silently detaches every campaign built on the old name, so they are
 * pinned here the same way the badge keys are.
 */

test("tags are derived from the badge key, not its label", () => {
  // Labels are draft copy Matt rewrites; keys are the thing we promised not
  // to rename. A tag following the copy would orphan the CRM on a word change.
  assert.equal(badgeTag("attendance:gold"), "momentum-attendance-gold");
  assert.equal(badgeTag("milestone:founding"), "momentum-milestone-founding");
  assert.equal(badgeTag("level:committed"), "momentum-level-committed");
});

test("every tag is lowercase, prefixed, and safe for a CRM", () => {
  for (const b of selectableBadges()) {
    const tag = badgeTag(b.key);
    assert.ok(tag.startsWith("momentum-"), `${tag} is missing the namespace`);
    assert.equal(tag, tag.toLowerCase());
    assert.match(tag, /^[a-z0-9-]+$/);
  }
});

test("distinct badges never collapse to the same tag", () => {
  // Two badges sharing a tag would merge two audiences into one offer.
  const tags = selectableBadges().map((b) => badgeTag(b.key));
  assert.equal(new Set(tags).size, tags.length);
});
