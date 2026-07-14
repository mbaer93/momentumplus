import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  channelsForTier,
  generateStreamUserToken,
  isStreamConfigured,
  streamRoleForTier,
} from "@/lib/stream";

/*
 * Issues a Stream Chat user token for the signed-in member with tier-based
 * channel grants (SPEC.md §4). The Stream API secret stays server-side.
 * Channel membership is granted server-side here — never trusted from the UI.
 */
export async function POST() {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isStreamConfigured()) {
    return NextResponse.json(
      { error: "Community chat isn't configured yet." },
      { status: 503 },
    );
  }

  let userId = "preview-member";
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    userId = user.id;
  }

  const token = generateStreamUserToken(
    userId,
    process.env.STREAM_API_SECRET!,
    { expSeconds: 60 * 60 * 24 },
  );

  const channels = channelsForTier(member.tier);

  return NextResponse.json(
    {
      apiKey: process.env.NEXT_PUBLIC_STREAM_API_KEY,
      token,
      userId,
      userName: member.name,
      role: streamRoleForTier(member.tier),
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        adminPostOnly: Boolean(c.adminPostOnly),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
