import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "crypto";
import { generateMuxPlaybackToken } from "../lib/mux";
import { parseSummaryResponse } from "../lib/ai-summary";
import { gradientFor } from "../lib/videos/data";

test("generateMuxPlaybackToken produces a verifiable RS256 JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const token = generateMuxPlaybackToken("playback123", {
    keyId: "key-1",
    privateKey,
    expSeconds: 3600,
    nowSeconds: 1000,
  });

  const [h, p, s] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  assert.deepEqual(header, { alg: "RS256", typ: "JWT", kid: "key-1" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.sub, "playback123");
  assert.equal(payload.aud, "v");
  assert.equal(payload.exp, 4600);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(s, "base64url")), true);
});

test("generateMuxPlaybackToken accepts base64-encoded keys (Mux default)", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const b64 = Buffer.from(privateKey).toString("base64");
  const token = generateMuxPlaybackToken("pb", {
    keyId: "k",
    privateKey: b64,
    nowSeconds: 0,
  });
  assert.equal(token.split(".").length, 3);
});

test("parseSummaryResponse extracts JSON from prose and fences", () => {
  const wrapped = `Here is the summary:\n\`\`\`json\n{"takeaways":["a","b"],"quotes":["q"],"action_items":["do it"],"highlights":"Overview."}\n\`\`\`\nDone.`;
  const parsed = parseSummaryResponse(wrapped);
  assert.deepEqual(parsed?.takeaways, ["a", "b"]);
  assert.equal(parsed?.highlights, "Overview.");

  assert.equal(parseSummaryResponse("no json here"), null);
  assert.equal(parseSummaryResponse('{"unrelated": true}'), null);
  // Non-string array entries are filtered.
  const messy = parseSummaryResponse(
    '{"takeaways":["ok", 42, null], "highlights":"h"}',
  );
  assert.deepEqual(messy?.takeaways, ["ok"]);
});

test("gradientFor is deterministic", () => {
  assert.equal(gradientFor("same-id"), gradientFor("same-id"));
  assert.ok(gradientFor("x").startsWith("linear-gradient"));
});
