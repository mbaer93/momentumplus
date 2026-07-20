import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Member directory for starting a direct message. Only members who have
 * COMPLETED registration (set their name) and hold a usable membership are
 * listed — invited-but-never-finished accounts used to show up as an
 * anonymous wall of "Member" rows.
 */

async function dmDirectory(viewerId: string): Promise<
  { id: string; name: string; detail: string }[]
> {
  const admin = createServiceClient();
  // Membership first: the DM list is members-only in both directions.
  const { rows: memberships } = await allRows<{ profile_id: string }>(
    (from, to) =>
      admin
        .from("memberships")
        .select("profile_id")
        .in("status", ["active", "past_due"])
        .order("profile_id")
        .range(from, to),
  );
  const memberIds = new Set(memberships.map((m) => m.profile_id));
  memberIds.delete(viewerId);
  if (memberIds.size === 0) return [];

  const { rows: profiles } = await allRows<{
    id: string;
    full_name: string | null;
    title: string | null;
    company: string | null;
  }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name, title, company")
      .not("full_name", "is", null)
      .neq("full_name", "")
      .order("full_name")
      .range(from, to),
  );

  return profiles
    .filter((p) => memberIds.has(p.id) && (p.full_name ?? "").trim())
    .map((p) => ({
      id: p.id,
      name: (p.full_name as string).trim(),
      detail: [p.title, p.company].filter(Boolean).join(" · "),
    }));
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ members: [] });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  return NextResponse.json({ members: await dmDirectory(user.id) });
}

/**
 * Prepare a DM target: verify they're a listed member, then make sure they
 * exist as a Stream user — DMing someone who has never opened chat
 * otherwise fails with "please create the user objects".
 */
export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const targetId = String(body.id ?? "");
  const target = (await dmDirectory(user.id)).find((m) => m.id === targetId);
  if (!target) {
    return NextResponse.json({ error: "Not a listed member" }, { status: 404 });
  }
  const { ensureStreamUser } = await import("@/lib/stream");
  const ok = await ensureStreamUser(target.id, target.name);
  return NextResponse.json({ ok });
}
