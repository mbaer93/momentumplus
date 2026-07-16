import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Member directory for starting a direct message: id + display name of
 * every member except the viewer. Members-only (active membership).
 */
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

  const { data } = await createServiceClient()
    .from("profiles")
    .select("id, full_name, email, title, company")
    .neq("id", user.id)
    .order("full_name")
    .limit(500);

  return NextResponse.json({
    members: (data ?? []).map((p) => ({
      id: p.id,
      name: p.full_name || p.email || "Member",
      detail: [p.title, p.company].filter(Boolean).join(" · "),
    })),
  });
}
