import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import {
  channelsForTicket,
  EVENT_CHANNELS,
  generateStreamUserToken,
  isStreamConfigured,
} from "@/lib/stream";
import { isVipRegistration } from "@/lib/summit";
import { getMyTicket } from "@/lib/summit-queries";

/*
 * Issues a Stream Chat user token for the signed-in attendee with
 * ticket-based channel grants (VIP ticket unlocks the lounge). The Stream
 * API secret stays server-side; channel membership is granted here — never
 * trusted from the UI.
 */
export async function POST() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isStreamConfigured()) {
    return NextResponse.json(
      { error: "Community chat isn't configured yet." },
      { status: 503 },
    );
  }

  const ticket = await getMyTicket();
  const isVip = Boolean(
    ticket && isVipRegistration(ticket.registrationType),
  );
  const channels = channelsForTicket({ isVip, isAdmin: member.isAdmin });

  const token = generateStreamUserToken(
    member.id,
    process.env.STREAM_API_SECRET!,
    { expSeconds: 60 * 60 * 24 },
  );

  // Upsert the Stream user, then ADD them as a member of every channel their
  // ticket allows — Stream's "user" role only sees channels it belongs to.
  // Best-effort per step so a hiccup on one channel doesn't block the rest.
  try {
    const { StreamChat } = await import("stream-chat");
    const server = StreamChat.getInstance(
      process.env.NEXT_PUBLIC_STREAM_API_KEY!,
      process.env.STREAM_API_SECRET!,
    );
    const streamUser = {
      id: member.id,
      name: member.name,
      role: member.isAdmin ? "admin" : "user",
      adminTitle: member.isAdmin ? "TSLS Team" : "",
    };
    const teamUser = {
      id: "tsls-team",
      name: "TSLS Team",
      role: "admin",
      adminTitle: "TSLS Team",
    };
    await server.upsertUsers([streamUser, teamUser] as unknown as Parameters<
      typeof server.upsertUsers
    >[0]);

    const allowedIds = new Set(channels.map((c) => c.id));
    await Promise.all(
      EVENT_CHANNELS.map(async (c) => {
        try {
          const channel = server.channel("messaging", c.id, {
            created_by_id: "tsls-team",
            ...({ name: c.name } as object),
          });
          await channel.create();
          // Admin-post-only is enforced BY STREAM, not just our UI: frozen
          // channels reject client-side sends. Team posts go through the
          // server, which frozen doesn't block.
          if (c.adminPostOnly) {
            await channel.updatePartial({ set: { frozen: true } });
          }
          if (allowedIds.has(c.id)) {
            await channel.addMembers([member.id]);
          } else if (!member.isAdmin) {
            await channel.removeMembers([member.id]);
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
      userId: member.id,
      userName: member.name,
      role: { badge: member.isAdmin ? "Admin" : isVip ? "VIP" : "Attendee" },
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
