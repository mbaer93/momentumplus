import { createHmac } from "crypto";

/*
 * Stream Chat for the EVENT community — a Stream app of its own, completely
 * separate from the Momentum+ community (Matt, 2026-07-20). The server
 * issues user tokens with ticket-based channel grants; the API secret never
 * reaches the client.
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
  /** Which attendees may join. */
  gate: "all" | "vip";
  /** Only admins may post (announcements). */
  adminPostOnly?: boolean;
}

export const EVENT_CHANNELS: CommunityChannel[] = [
  {
    id: "general",
    name: "general",
    description: "Event-wide conversation — say hello",
    gate: "all",
  },
  {
    id: "announcements",
    name: "announcements",
    description: "Official event updates (TSLS team posts only)",
    gate: "all",
    adminPostOnly: true,
  },
  // Keeps the id CommunityView special-cases for the speaker question
  // picker; displayed as ask-a-speaker.
  {
    id: "speaker-qa",
    name: "ask-a-speaker",
    description: "Questions for the people on stage",
    gate: "all",
  },
  {
    id: "networking",
    name: "networking",
    description: "Find your people — trade contacts and plans",
    gate: "all",
  },
  {
    id: "vip-lounge",
    name: "vip-lounge",
    description: "The VIP Leadership Experience room",
    gate: "vip",
  },
];

/** Channels this attendee may join (VIP ticket unlocks the lounge). */
export function channelsForTicket(opts: {
  isVip: boolean;
  isAdmin: boolean;
}): CommunityChannel[] {
  return EVENT_CHANNELS.filter(
    (ch) => ch.gate === "all" || opts.isVip || opts.isAdmin,
  );
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
 * Make sure a user exists on Stream (id + display name). DMing someone who
 * has never opened chat otherwise fails channel creation. Best-effort.
 */
export async function ensureStreamUser(
  userId: string,
  name: string,
): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const secret = process.env.STREAM_API_SECRET;
  if (!apiKey || !secret) return false;
  try {
    const { StreamChat } = await import("stream-chat");
    const client = StreamChat.getInstance(apiKey, secret);
    await client.upsertUser({ id: userId, name });
    return true;
  } catch {
    return false;
  }
}
