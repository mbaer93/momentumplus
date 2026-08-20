import { NextResponse, type NextRequest } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge-auth";
import { rateLimited } from "@/lib/rate-limit";

/*
 * Authenticated no-op for the TSLS health cron: proves the shared bridge
 * key actually PAIRS (TSLS's MOMENTUM_PROVISION_KEY === our bridge key),
 * which a boolean "the env var exists" check on either side can't. Reads
 * nothing, writes nothing.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!bridgeAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Inbound ceiling AFTER the key check, so an unauthorized caller cannot
  // burn the budget for the real one (TSLS review, 2026-08-19).
  const limited = await rateLimited("bridge/ping");
  if (limited) return limited;
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
