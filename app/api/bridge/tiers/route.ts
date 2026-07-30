import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { updateTag } from "next/cache";
import { revalidatePath } from "next/cache";

/*
 * Sponsorship-tier catalog sync from TSLS (the source of truth — Matt,
 * 2026-07-29). TSLS pushes the FULL catalog on every Event Planning save;
 * we mirror it wholesale into sponsor_tiers (migration 0067): upsert every
 * row sent, drop rows no longer in the list. Same trust boundary as the
 * profile bridge (x-api-key = ZAPIER_WEBHOOK_SECRET, which TSLS holds as
 * MOMENTUM_PROVISION_KEY).
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.ZAPIER_WEBHOOK_SECRET;
  if (!secret) return false;
  const key =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const { timingSafeEqual, createHash } = require("crypto") as typeof import("crypto");
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  let body: { tiers?: unknown };
  try {
    body = (await req.json()) as { tiers?: unknown };
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.tiers) || body.tiers.length === 0) {
    // An empty catalog is far more likely a TSLS bug than an intent to
    // delete every tier — refuse rather than blank the directory.
    return NextResponse.json({ error: "tiers[] required" }, { status: 400 });
  }

  const rows = body.tiers
    .map((t) => {
      const r = t as Record<string, unknown>;
      const value = String(r.value ?? "").trim();
      const label = String(r.label ?? "").trim();
      if (!value || !label) return null;
      return {
        value: value.slice(0, 60),
        label: label.slice(0, 120),
        price: Math.max(0, Math.round(Number(r.price) || 0)),
        in_kind: Boolean(r.in_kind),
        available:
          r.available === null || r.available === undefined
            ? null
            : Math.max(0, Math.round(Number(r.available) || 0)),
        sold_out: Boolean(r.sold_out),
        vip_tickets: Math.max(0, Math.round(Number(r.vip_tickets) || 0)),
        highlights: Array.isArray(r.highlights)
          ? r.highlights.map(String).slice(0, 12)
          : [],
        sort: Math.round(Number(r.sort) || 100),
        active: r.active !== false,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid tiers" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error: upErr } = await admin
    .from("sponsor_tiers")
    .upsert(rows, { onConflict: "value" });
  if (upErr) {
    if (/sponsor_tiers/.test(upErr.message)) {
      return NextResponse.json(
        { error: "Run Momentum+ migration 0067 first." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  const keep = rows.map((r) => r.value);
  await admin
    .from("sponsor_tiers")
    .delete()
    .not("value", "in", `(${keep.map((v) => `"${v}"`).join(",")})`);

  revalidatePath("/sponsors");
  revalidatePath("/admin/sponsors");
  updateTag("sponsors");
  return NextResponse.json({ ok: true, count: rows.length });
}
