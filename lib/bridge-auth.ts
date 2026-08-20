import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

/*
 * Shared auth for the TSLS→Momentum+ bridge routes. Accepts either
 * MOMENTUM_BRIDGE_KEY (the dedicated bridge secret — set the same value
 * as TSLS's MOMENTUM_PROVISION_KEY) or the legacy ZAPIER_WEBHOOK_SECRET.
 * The dual check exists because Vercel can't reveal a stored secret to
 * copy across projects (Matt, 2026-07-29): minting a fresh value for both
 * sides is the only workable setup path, and the legacy key keeps any
 * existing caller working.
 */
function presentedKey(req: NextRequest): string {
  return (
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

/** Constant-time match against any configured secret. Unset secrets are
    skipped, so a missing env var fails closed rather than matching "". */
function matchesAny(key: string, secrets: (string | undefined)[]): boolean {
  const hashed = createHash("sha256").update(key).digest();
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHash("sha256").update(secret).digest();
    if (timingSafeEqual(hashed, expected)) return true;
  }
  return false;
}

export function bridgeAuthorized(req: NextRequest): boolean {
  return matchesAny(presentedKey(req), [
    process.env.MOMENTUM_BRIDGE_KEY,
    process.env.ZAPIER_WEBHOOK_SECRET,
  ]);
}

/**
 * The reveal is the one irreversible thing on this bridge, and it needs its
 * OWN secret (TSLS security review, 2026-08-19).
 *
 * Their framing, which is the right one: the provisioning key is handled
 * routinely — it lives in a sync loop that runs all day — while the reveal
 * key is used once, ever. Sharing them means one leaked env var can activate
 * every parked grant and email every guest at the wrong moment. That is not
 * recoverable: you cannot un-send 77 emails or un-spoil the moment on stage.
 *
 * MOMENTUM_REVEAL_KEY is therefore required for a real activation, and the
 * provisioning key does NOT open it. Deliberately no fallback: a reveal that
 * silently accepted the bridge key would be the gap with extra steps.
 *
 * A DRY RUN still accepts either key. It writes nothing, and TSLS needs to
 * verify its wiring and read the count without being handed the once-ever
 * secret — which is the same reason the two are separated at all.
 */
export function revealAuthorized(req: NextRequest): boolean {
  return matchesAny(presentedKey(req), [process.env.MOMENTUM_REVEAL_KEY]);
}

/** Is the dedicated reveal secret configured at all? Distinguishes "wrong
    key" (401) from "nobody set this up" (503), which are different problems
    at 9am on event day. */
export function revealKeyConfigured(): boolean {
  return Boolean(process.env.MOMENTUM_REVEAL_KEY);
}
