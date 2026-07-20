import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Attendee directory for starting a direct message. Served via the service
 * role so profile emails/flags never need a client-side read policy. Only
 * attendees who have a display name are listed.
 */

async function dmDirectory(viewerId: string): Promise<
  { id: string; name: string; detail: string }[]
> {
  const admin = createServiceClient();
  const { rows: attendees } = await allRows<{
    profile_id: string | null;
    registration_type: string | null;
  }>((from, to) =>
    admin
      .from("attendees")
      .select("profile_id, registration_type")
      .order("email")
      .range(from, to),
  );
  const ticketByProfile = new Map(
    attendees
      .filter((a) => a.profile_id)
      .map((a) => [a.profile_id as string, a.registration_type ?? ""]),
  );

  const { rows: profiles } = await allRows<{
    id: string;
    full_name: string | null;
    is_admin: boolean | null;
  }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name, is_admin")
      .not("full_name", "is", null)
      .neq("full_name", "")
      .order("full_name")
      .range(from, to),
  );

  return profiles
    .filter(
      (p) =>
        p.id !== viewerId &&
        (ticketByProfile.has(p.id) || p.is_admin) &&
        (p.full_name ?? "").trim(),
    )
    .map((p) => ({
      id: p.id,
      name: (p.full_name as string).trim(),
      detail: p.is_admin
        ? "TSLS Team"
        : ticketByProfile.get(p.id) || "Attendee",
    }));
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ members: [] });
  }
  return NextResponse.json({ members: await dmDirectory(member.id) });
}

/**
 * Prepare a DM target: verify they're a listed attendee, then make sure they
 * exist as a Stream user — DMing someone who has never opened chat
 * otherwise fails with "please create the user objects".
 */
export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true });
  }

  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const targetId = String(body.id ?? "");
  const target = (await dmDirectory(member.id)).find((m) => m.id === targetId);
  if (!target) {
    return NextResponse.json({ error: "Not a listed attendee" }, { status: 404 });
  }
  const { ensureStreamUser } = await import("@/lib/stream");
  const ok = await ensureStreamUser(target.id, target.name);
  return NextResponse.json({ ok });
}
