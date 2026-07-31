import { NextResponse, type NextRequest } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge-auth";

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
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
