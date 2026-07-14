import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { generateZoomSignature } from "../lib/zoom-signature";

function decodeSegment(segment: string): Record<string, unknown> {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

test("generateZoomSignature returns a well-formed HS256 JWT", () => {
  const sig = generateZoomSignature({
    sdkKey: "sdk_key_123",
    sdkSecret: "shhh-secret",
    meetingNumber: "9876543210",
    role: 0,
    nowSeconds: 1_000_000,
  });

  const parts = sig.split(".");
  assert.equal(parts.length, 3);

  const header = decodeSegment(parts[0]);
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });

  const payload = decodeSegment(parts[1]);
  assert.equal(payload.sdkKey, "sdk_key_123");
  assert.equal(payload.appKey, "sdk_key_123");
  assert.equal(payload.mn, "9876543210");
  assert.equal(payload.role, 0);
  assert.equal(payload.iat, 1_000_000 - 30);
  assert.equal(payload.exp, payload.tokenExp);
  assert.equal(payload.exp, 1_000_000 - 30 + 7200);
});

test("generateZoomSignature signature verifies against the secret", () => {
  const sig = generateZoomSignature({
    sdkKey: "k",
    sdkSecret: "the-secret",
    meetingNumber: "123",
    nowSeconds: 42,
  });
  const [h, p, s] = sig.split(".");
  const expected = createHmac("sha256", "the-secret")
    .update(`${h}.${p}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(s, expected);
});

test("a wrong secret produces a different signature", () => {
  const base = { sdkKey: "k", meetingNumber: "1", nowSeconds: 1 } as const;
  const a = generateZoomSignature({ ...base, sdkSecret: "secret-a" });
  const b = generateZoomSignature({ ...base, sdkSecret: "secret-b" });
  assert.notEqual(a, b);
});
