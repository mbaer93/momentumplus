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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    userId = user.id;

    // Pre-season speakers are hidden from the community until October 1 of
    // the year they join — no chat until their season starts.
    if (member.tier === "speaker" && !member.isAdmin) {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const { speakerLive } = await import("@/lib/sponsor-lifecycle");
      const { data: sp } = await createServiceClient()
        .from("speakers")
        .select("expires_at, archived_at")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (
        sp &&
        !speakerLive({
          archivedAt: (sp.archived_at as string | null) ?? null,
          expiresAt: (sp.expires_at as string | null) ?? null,
        })
      ) {
        return NextResponse.json(
          {
            error:
              "Community opens for speakers on October 1, when your season begins. Until then you can build your speaker page in the Speaker Studio.",
          },
          { status: 403 },
        );
      }
    }
  }

  const token = generateStreamUserToken(
    userId,
    process.env.STREAM_API_SECRET!,
    { expSeconds: 60 * 60 * 24 },
  );

  const channels = channelsForTier(member.tier);

  // Channel membership only changes when the member's tier / admin state /
  // display name does — provisioning is ~16 Stream API calls, so at 2,500
  // members re-running it on every community open would rate-limit Stream
  // on event day. The synced key marks "already provisioned for exactly
  // this state"; any change (or a missing 0069 column) re-provisions.
  /*
   * The engagement level rides on the Stream user, exactly as adminTitle
   * does — Stream owns the message list, so anything shown beside a name in
   * chat has to be a field on the user. It is part of the sync key, or a
   * member who levels up keeps the old chip until something ELSE about them
   * changes.
   */
  const badgeLevel = await (async () => {
    if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return "";
    }
    try {
      const { badgesForOthers } = await import("@/lib/badge-queries");
      const badges = (await badgesForOthers([userId])).get(userId);
      // Absent = opted out. "start" is the entry level and shows no chip.
      if (!badges || badges.level.key === "start") return "";
      return badges.level.label;
    } catch {
      // A badge is decoration; chat access is not. Never block the token.
      return "";
    }
  })();

  const syncKey = [
    member.tier,
    member.isAdmin ? "1" : "0",
    member.name,
    member.adminTitle ?? "",
    badgeLevel,
  ].join("|");
  let alreadyProvisioned = false;
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const { data: marker } = await createServiceClient()
        .from("profiles")
        .select("stream_synced_key")
        .eq("id", userId)
        .maybeSingle();
      alreadyProvisioned = marker?.stream_synced_key === syncKey;
    } catch {
      // pre-0069 — provision every time, as before
    }
  }

  // Upsert the Stream user server-side (admins get Stream's admin role and
  // their title as a custom field), then ADD the user as a member of every
  // channel their tier allows. Without the membership grant, non-admin
  // users can't even read the channels — Stream's "user" role only sees
  // channels it belongs to. Best-effort per step so a hiccup on one channel
  // doesn't block the rest.
  if (!alreadyProvisioned) {
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
        // Empty for members who opted out, or who are at the entry level.
        badgeLevel,
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
      const results = await Promise.all(
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
            return true;
          } catch {
            return false; // per-channel best-effort
          }
        }),
      );
      // Stamp only a COMPLETE provisioning — a partial one (Stream hiccup on
      // one channel) retries on the next open instead of sticking forever.
      if (
        results.every(Boolean) &&
        isSupabaseConfigured() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        try {
          const { createServiceClient } = await import("@/lib/supabase/admin");
          await createServiceClient()
            .from("profiles")
            .update({ stream_synced_key: syncKey })
            .eq("id", userId);
        } catch {
          // pre-0069 — nothing to stamp
        }
      }
    } catch {
      // non-fatal
    }
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
