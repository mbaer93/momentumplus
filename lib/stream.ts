import { createHmac } from "crypto";
import { isPro, isVipPlus } from "./access";
import type { Tier } from "./types";

/*
 * Stream Chat integration (SPEC.md §4). The server issues Stream user tokens
 * with tier-based channel grants at login; the API secret never reaches the
 * client. Channels are provisioned idempotently by the token route.
 */

export function isStreamConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_STREAM_API_KEY && process.env.STREAM_API_SECRET,
  );
}

export interface CommunityChannel {
  id: string;
  name: string;
  description: string;
  /** Which members may read/write. */
  gate: "all_members" | "vip_plus" | "pro";
  /** Only admins may post (announcements). */
  adminPostOnly?: boolean;
}

// SPEC.md §4 channel list.
export const COMMUNITY_CHANNELS: CommunityChannel[] = [
  {
    id: "general",
    name: "general",
    description: "Community-wide announcements and conversation",
    gate: "all_members",
  },
  {
    id: "announcements",
    name: "announcements",
    description: "Official Momentum+ updates (admin posts only)",
    gate: "all_members",
    adminPostOnly: true,
  },
  {
    id: "networking",
    name: "networking",
    description: "Make connections with leaders nationwide",
    gate: "all_members",
  },
  {
    id: "speaker-qa",
    name: "speaker-qa",
    description: "Ask our speakers anything",
    gate: "all_members",
  },
  {
    id: "resources",
    name: "resources",
    description: "Shared tools, templates, and reading",
    gate: "all_members",
  },
  // Stream channel ids are permanent (they anchor message history), so the
  // two premium rooms keep their original ids and only their display names
  // and gates evolved with the July 2026 member levels.
  {
    id: "vip-only",
    name: "inner-circle",
    description: "The inner circle — Pro members, speakers & sponsors",
    gate: "vip_plus",
  },
  {
    id: "annual-members",
    name: "pro-members",
    description: "The Pro lounge — for Momentum+ Pro members",
    gate: "pro",
  },
];

/** Which of the community channels this tier may join (SPEC.md §4 gates). */
export function channelsForTier(tier: Tier): CommunityChannel[] {
  return COMMUNITY_CHANNELS.filter((ch) => {
    switch (ch.gate) {
      case "all_members":
        return true;
      case "vip_plus":
        return isVipPlus(tier);
      case "pro":
        return isPro(tier);
      default:
        return false;
    }
  });
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Stream user token: JWT HS256 with { user_id } signed by the API secret.
 * Optionally short-lived via expSeconds (Stream accepts exp/iat claims).
 */
/**
 * Erase a member from Stream Chat on account deletion — the user record and
 * their messages/DMs, which otherwise persist on Stream's servers after the
 * app-side account is gone. Best-effort; never throws.
 */
export async function deleteStreamUser(userId: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const secret = process.env.STREAM_API_SECRET;
  if (!apiKey || !secret) return;
  try {
    const { StreamChat } = await import("stream-chat");
    const client = StreamChat.getInstance(apiKey, secret);
    await client.deleteUser(userId, {
      mark_messages_deleted: true,
      hard_delete: true,
    });
  } catch {
    // Stream may not know this user (never chatted) — nothing to erase.
  }
}

/**
 * Total unread community messages for a member, fetched server-side (the
 * dashboard "New Messages" stat). Best-effort: 0 when Stream is off, the
 * member has never chatted, or the API hiccups.
 */
export async function getUnreadTotal(userId: string): Promise<number> {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const secret = process.env.STREAM_API_SECRET;
  if (!apiKey || !secret) return 0;
  try {
    const { StreamChat } = await import("stream-chat");
    const client = StreamChat.getInstance(apiKey, secret);
    const res = await client.getUnreadCount(userId);
    return res.total_unread_count ?? 0;
  } catch {
    return 0;
  }
}

export function generateStreamUserToken(
  userId: string,
  secret: string,
  opts: { expSeconds?: number; nowSeconds?: number } = {},
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload: Record<string, unknown> = { user_id: userId };
  if (opts.expSeconds) {
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    payload.iat = now - 30;
    payload.exp = now + opts.expSeconds;
  }
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

/**
 * Server-side post into a community channel as the "Momentum+ Team" system
 * user (admin badge in chat). Used by scheduled posts. Creates the channel
 * if no member has opened it yet.
 */
export async function sendCommunityMessage(
  channelId: string,
  text: string,
): Promise<void> {
  if (!isStreamConfigured()) {
    throw new Error("Stream Chat is not configured.");
  }
  const { StreamChat } = await import("stream-chat");
  const client = StreamChat.getInstance(
    process.env.NEXT_PUBLIC_STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!,
  );
  const teamUser = {
    id: "momentum-team",
    name: "Momentum+ Team",
    role: "admin",
    // Custom field rendered next to the Admin badge in chat.
    adminTitle: "Momentum+ Team",
  };
  await client.upsertUser(
    teamUser as unknown as Parameters<typeof client.upsertUser>[0],
  );
  const meta = COMMUNITY_CHANNELS.find((c) => c.id === channelId);
  const channel = client.channel("messaging", channelId, {
    created_by_id: "momentum-team",
    ...(meta ? { name: meta.name } : {}),
  });
  await channel.create();
  await channel.sendMessage({ text, user_id: "momentum-team" });
}

/** Stream role metadata derived from the membership tier (badges in chat). */
export function streamRoleForTier(tier: Tier): {
  memberTier: Tier;
  badge: string;
} {
  const badge =
    tier === "admin"
      ? "Admin"
      : tier === "speaker"
        ? "Speaker"
        : tier === "sponsor"
          ? "Sponsor"
          : tier === "tsls_vip"
            ? "VIP"
            : tier === "sub_annual"
              ? "Annual"
              : "Member";
  return { memberTier: tier, badge };
}
