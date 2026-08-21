import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  base64urlToBuffer,
  bufferToBase64url,
  decodeCredentialOptions,
} from "../lib/webauthn-encoding";

/*
 * Passkeys as a second factor (Matt, 2026-08-21), ADDED alongside TOTP.
 *
 * The gate needed no changes — both are MFA factors and both raise the
 * session to aal2 — so what is worth pinning is the encoding (where a
 * single wrong field yields an opaque NotAllowedError) and the decisions
 * that keep a lost passkey from becoming a lockout.
 */

test("base64url round-trips, and is not plain base64", () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const encoded = bufferToBase64url(bytes.buffer);
  // The whole point of base64URL: no +, no /, no padding. Feeding standard
  // base64 to the browser silently corrupts a challenge.
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(new Uint8Array(base64urlToBuffer(encoded)), bytes);
});

test("a large buffer does not blow the stack", () => {
  // String.fromCharCode(...bytes) overflows on a big attestation object,
  // which only some authenticators produce — so it is chunked.
  const big = new Uint8Array(200_000).fill(65);
  assert.equal(new Uint8Array(base64urlToBuffer(bufferToBase64url(big.buffer))).length, 200_000);
});

test("every buffer field WebAuthn requires is decoded", () => {
  /*
   * challenge, user.id and the credential id lists arrive as strings and
   * must reach the browser as ArrayBuffers. Missing one is the classic
   * cause of a ceremony that fails with no usable error.
   */
  const decoded = decodeCredentialOptions({
    challenge: "AAEC",
    user: { id: "AAEC", name: "matt" },
    excludeCredentials: [{ id: "AAEC", type: "public-key" }],
    allowCredentials: [{ id: "AAEC", type: "public-key" }],
    rp: { id: "momentumplus.co" },
  }) as unknown as Record<string, unknown>;

  assert.ok(decoded.challenge instanceof ArrayBuffer);
  assert.ok((decoded.user as { id: unknown }).id instanceof ArrayBuffer);
  for (const key of ["excludeCredentials", "allowCredentials"]) {
    const list = decoded[key] as { id: unknown }[];
    assert.ok(list[0].id instanceof ArrayBuffer, `${key}[0].id not decoded`);
  }
  // Untouched fields survive.
  assert.deepEqual(decoded.rp, { id: "momentumplus.co" });
});

test("the relying party is derived from the live host, never hardcoded", () => {
  /*
   * A passkey is BOUND to the rpId. Hardcoding the production domain would
   * make enrolment fail everywhere else with an opaque NotAllowedError,
   * and hardcoding anything else would silently bind passkeys to a domain
   * that is not ours.
   */
  const src = readFileSync("app/(portal)/admin/security/actions.ts", "utf8");
  assert.match(src, /async function relyingPartyId/);
  assert.match(src, /requestSiteUrl/);
  assert.doesNotMatch(src, /rpId: ["']momentumplus/);
});

test("enrolment and verification use the right ceremony", () => {
  // 'create' registers a new passkey; 'request' asserts an existing one.
  // Swapping them fails server-side with a generic error.
  const enrol = readFileSync("app/(portal)/admin/security/actions.ts", "utf8");
  assert.match(enrol, /type: "create"/);
  const verify = readFileSync("app/(auth)/verify/actions.ts", "utf8");
  assert.match(verify, /type: "request"/);
  // The field is credential_response, not `credential`.
  assert.match(enrol, /credential_response:/);
  assert.match(verify, /credential_response:/);
});

test("the code stays available on the verify screen", () => {
  /*
   * The reason passkeys were added alongside TOTP rather than replacing
   * it: a lost passkey needs database access to clear, where a lost code
   * is restored from 1Password. If the passkey button ever became the only
   * way through, that fallback would be gone.
   */
  const form = readFileSync("app/(auth)/verify/VerifyForm.tsx", "utf8");
  assert.match(form, /Use a passkey/);
  assert.match(form, /Six-digit code/);
  assert.match(form, /verifySecondFactor\(/);
});

test("a passkey failure points at the code, not a dead end", () => {
  const form = readFileSync("app/(auth)/verify/VerifyForm.tsx", "utf8");
  const handler = form.slice(form.indexOf("async function signInWithPasskey"));
  assert.match(handler, /use your code/i);
  // NotAllowedError means cancel, timeout OR wrong origin — the message
  // must not pretend to know which.
  assert.match(handler, /NotAllowedError/);
});

test("the passkey helper is not named like a React hook", () => {
  // `usePasskey` tripped rules-of-hooks: React reads the `use` prefix as a
  // hook and refuses the onClick call.
  const form = readFileSync("app/(auth)/verify/VerifyForm.tsx", "utf8");
  assert.doesNotMatch(form, /function usePasskey/);
});

test("the gate itself was not touched", () => {
  /*
   * Both factor types raise the session to aal2, so mustVerify keys off the
   * level rather than the kind. If this ever grew a factor-type check, one
   * kind would stop counting.
   */
  const mfa = readFileSync("lib/mfa.ts", "utf8");
  assert.match(mfa, /mustVerify:\s*next === "aal2" && current === "aal1"/);
  const status = mfa.slice(mfa.indexOf("export const mfaStatus"), mfa.indexOf("listFactorsOfType"));
  assert.doesNotMatch(status, /webauthn|totp/, "the gate must stay factor-agnostic");
});
