import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Sponsor impression/click tracking (SPEC.md §5 — impressions batched).
 * Body: { kind: "impression" | "click", sponsorIds: string[] }
 * Preview mode: accepted and dropped. profile_id is recorded when signed in
 * (nullable in schema for anonymous events).
 */
export async function POST(req: NextRequest) {
  let body: { kind?: string; sponsorIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind === "click" ? "click" : "impression";
  const ids = (body.sponsorIds ?? []).filter(
    (x): x is string => typeof x === "string",
  );
  if (ids.length === 0 || ids.length > 20) {
    return NextResponse.json({ error: "sponsorIds required (max 20)" }, { status: 400 });
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, preview: true });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Members only: anonymous inserts would let anyone inflate the sponsor
  // stats we report (and bloat the table).
  if (!user) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("sponsor_events").insert(
    ids.map((sponsor_id) => ({
      sponsor_id,
      profile_id: user.id,
      kind,
    })),
  );
  if (error) {
    // Tracking must never break the page — report ok anyway, log server-side.
    console.error("[sponsors/track]", error.message);
  }
  return NextResponse.json({ ok: true });
}
