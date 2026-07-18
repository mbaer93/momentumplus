import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import {
  channelsForTier,
  COMMUNITY_CHANNELS,
  generateStreamUserToken,
} from "../lib/stream";
import { defaultPrefs, mergePrefs } from "../lib/notifications";

function decode(seg: string) {
  return JSON.parse(
    Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
  );
}

test("channelsForTier enforces the member-level gates", () => {
  const ids = (tier: Parameters<typeof channelsForTier>[0]) =>
    channelsForTier(tier).map((c) => c.id);

  // Channel ids are permanent Stream anchors: "vip-only" is the vip_plus
  // inner circle; "annual-members" is the pro-gated Pro lounge.
  assert.ok(ids("basic").includes("general"));
  assert.ok(!ids("basic").includes("vip-only"));
  assert.ok(!ids("basic").includes("annual-members"));

  // The new VIP Access comp is Basic-level — no premium rooms.
  assert.ok(!ids("vip").includes("vip-only"));
  assert.ok(!ids("vip").includes("annual-members"));

  // Speakers join the inner circle but not the Pro lounge.
  assert.ok(ids("speaker").includes("vip-only"));
  assert.ok(!ids("speaker").includes("annual-members"));

  // Pro (and sponsor, its equivalent) get both premium rooms.
  assert.ok(ids("pro").includes("vip-only"));
  assert.ok(ids("pro").includes("annual-members"));
  assert.ok(ids("sponsor").includes("vip-only"));
  assert.ok(ids("sponsor").includes("annual-members"));

  assert.equal(ids("admin").length, COMMUNITY_CHANNELS.length);
});

test("announcements is admin-post-only", () => {
  const ann = COMMUNITY_CHANNELS.find((c) => c.id === "announcements");
  assert.equal(ann?.adminPostOnly, true);
});

test("generateStreamUserToken signs a valid HS256 JWT with user_id", () => {
  const token = generateStreamUserToken("user-123", "s3cret", {
    expSeconds: 3600,
    nowSeconds: 1000,
  });
  const [h, p, s] = token.split(".");
  assert.deepEqual(decode(h), { alg: "HS256", typ: "JWT" });
  const payload = decode(p);
  assert.equal(payload.user_id, "user-123");
  assert.equal(payload.exp, 4600);
  const expected = createHmac("sha256", "s3cret")
    .update(`${h}.${p}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(s, expected);
});

test("mergePrefs overlays saved rows and locks platform email on", () => {
  const merged = mergePrefs([
    { key: "session_reminder", email: false, sms: true, in_app: true },
    { key: "platform", email: false, sms: false, in_app: false },
  ]);
  const reminder = merged.find((p) => p.key === "session_reminder")!;
  assert.equal(reminder.email, false);
  assert.equal(reminder.sms, true);
  const platform = merged.find((p) => p.key === "platform")!;
  assert.equal(platform.email, true); // locked on
  assert.equal(platform.in_app, false);
  assert.equal(merged.length, defaultPrefs().length);
});
