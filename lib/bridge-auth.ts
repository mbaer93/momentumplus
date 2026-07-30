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
export function bridgeAuthorized(req: NextRequest): boolean {
  const key =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const hashed = createHash("sha256").update(key).digest();
  for (const secret of [
    process.env.MOMENTUM_BRIDGE_KEY,
    process.env.ZAPIER_WEBHOOK_SECRET,
  ]) {
    if (!secret) continue;
    const expected = createHash("sha256").update(secret).digest();
    if (timingSafeEqual(hashed, expected)) return true;
  }
  return false;
}
