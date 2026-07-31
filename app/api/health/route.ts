import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Public liveness endpoint: app up + database answering. Probed by the
 * TSLS app's health cron and usable by any external uptime monitor.
 * Deliberately a bare boolean — no versions, no service details, nothing
 * a stranger can learn from.
 */

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Preview builds have no database; the app itself is up.
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  }
  try {
    const { error } = await createServiceClient()
      .from("app_settings")
      .select("key")
      .limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS });
  }
}
