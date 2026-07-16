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

  // Upsert the Stream user server-side (admins get Stream's admin role and
  // their title as a custom field), then ADD the user as a member of every
  // channel their tier allows. Without the membership grant, non-admin
  // users can't even read the channels — Stream's "user" role only sees
  // channels it belongs to. Best-effort per step so a hiccup on one channel
  // doesn't block the rest.
  try {
    const { StreamChat } = await import("stream-chat");
    const server = StreamChat.getInstance(
      process.env.NEXT_PUBLIC_STREAM_API_KEY!,
      process.env.STREAM_API_SECRET!,
    );
    const streamUser = {
      id: userId,
      name: member.name,
      role: member.isAdmin ? "admin" : "user",
      // Custom field rendered next to the Admin badge in chat.
      adminTitle: member.isAdmin ? (member.adminTitle ?? "") : "",
    };
    const teamUser = {
      id: "momentum-team",
      name: "Momentum+ Team",
      role: "admin",
      adminTitle: "Momentum+ Team",
    };
    await server.upsertUsers([streamUser, teamUser] as unknown as Parameters<
      typeof server.upsertUsers
    >[0]);

    const allowedIds = new Set(channels.map((c) => c.id));
    const { COMMUNITY_CHANNELS } = await import("@/lib/stream");
    await Promise.all(
      COMMUNITY_CHANNELS.map(async (c) => {
        try {
          const channel = server.channel("messaging", c.id, {
            created_by_id: "momentum-team",
            ...({ name: c.name } as object),
          });
          await channel.create();
          // Admin-post-only is enforced BY STREAM, not just our UI: frozen
          // channels reject client-side sends, so a member connecting with
          // the SDK directly still can't post. Team posts go through the
          // server (announcement composer + scheduled-posts cron), which
          // frozen doesn't block.
          if (c.adminPostOnly) {
            await channel.updatePartial({ set: { frozen: true } });
          }
          if (allowedIds.has(c.id)) {
            await channel.addMembers([userId]);
          } else if (!member.isAdmin) {
            // Downgraded tier: revoke gated rooms, don't just hide them.
            await channel.removeMembers([userId]);
          }
        } catch {
          // per-channel best-effort
        }
      }),
    );
  } catch {
    // non-fatal
  }

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
