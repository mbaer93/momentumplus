import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { COMMUNITY_CHANNELS, isStreamConfigured } from "@/lib/stream";

/*
 * Pulling community message counts out of Stream (migration 0094).
 *
 * Stream owns the messages; this walks them and writes a per-member tally
 * so the "In the Conversation" badge track has something to count. Until
 * now that track was null — unearnable by anyone, and showing 0 holders in
 * every picker.
 *
 * A FULL recount each run rather than an incremental one. Incremental needs
 * a watermark, and a watermark is wrong the moment a message is edited,
 * deleted, or arrives out of order; a recount is simply correct, and the
 * volume this has to walk is a community's chat history, not a firehose.
 * Because badges are append-only (0091), a count that dips after someone
 * deletes a post cannot take a badge back.
 */

/** Pages of 200 per channel. A ceiling, so one runaway channel cannot eat
    the whole function window — reported when hit rather than passed over. */
const MAX_PAGES_PER_CHANNEL = 25;
const PAGE_SIZE = 200;

/*
 * Not a member: the system poster, and anything else that speaks as the
 * house. Counting it would award "In the Conversation" to an account nobody
 * holds and inflate the community's own totals.
 */
const NON_MEMBER_IDS = new Set(["momentum-team"]);

export interface CommunityCountResult {
  members: number;
  messages: number;
  channels: number;
  truncated: string[];
  error?: string;
}

/** Count every member's community messages and store the tally. */
export async function syncCommunityCounts(): Promise<CommunityCountResult> {
  const empty: CommunityCountResult = {
    members: 0,
    messages: 0,
    channels: 0,
    truncated: [],
  };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...empty, error: "Database not configured" };
  }
  if (!isStreamConfigured()) {
    return { ...empty, error: "Stream not configured" };
  }

  const { StreamChat } = await import("stream-chat");
  const client = StreamChat.getInstance(
    process.env.NEXT_PUBLIC_STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!,
  );

  const tally = new Map<string, number>();
  const truncated: string[] = [];
  let messages = 0;
  let channels = 0;

  for (const meta of COMMUNITY_CHANNELS) {
    /*
     * The announcements channel is admin-post-only, so nothing a member
     * could earn happens there. Skipping it is not an optimisation — it is
     * the difference between "messages you wrote" and "messages you were
     * sent".
     */
    if (meta.adminPostOnly) continue;

    const channel = client.channel("messaging", meta.id);
    let before: string | undefined;
    let pages = 0;
    let sawAny = false;

    try {
      for (; pages < MAX_PAGES_PER_CHANNEL; pages++) {
        const res = await channel.query({
          messages: { limit: PAGE_SIZE, ...(before ? { id_lt: before } : {}) },
          // Nothing else is needed, and asking for members/watchers on a
          // large channel is the slow part of this call.
          state: true,
          watchers: { limit: 0 },
        });
        const batch = res.messages ?? [];
        if (batch.length === 0) break;
        sawAny = true;
        for (const m of batch) {
          const id = m.user?.id;
          // Deleted messages come back with type "deleted" and no text —
          // they are not a contribution any more.
          if (!id || NON_MEMBER_IDS.has(id) || m.type === "deleted") continue;
          tally.set(id, (tally.get(id) ?? 0) + 1);
          messages += 1;
        }
        before = batch[0]?.id;
        if (batch.length < PAGE_SIZE) break;
      }
      if (pages >= MAX_PAGES_PER_CHANNEL) truncated.push(meta.id);
      if (sawAny) channels += 1;
    } catch {
      // A channel nobody has opened yet does not exist on Stream. Not an
      // error: it simply has no messages.
      continue;
    }
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  /*
   * Everyone who has ever posted gets a row; everyone else is left absent
   * rather than written as a zero. A table of zeros for the whole member
   * base would be noise, and the reader already treats "no row, table has
   * rows" as a real zero.
   */
  const rows = [...tally.entries()]
    .filter(([id]) => /^[0-9a-f-]{36}$/i.test(id))
    .map(([profile_id, count]) => ({
      profile_id,
      messages: count,
      counted_at: nowIso,
    }));

  if (rows.length > 0) {
    const { error } = await admin
      .from("community_message_counts")
      .upsert(rows, { onConflict: "profile_id" });
    if (error) {
      return { members: rows.length, messages, channels, truncated, error: error.message };
    }
  }

  /*
   * Anyone who had a count and no longer appears has had every message
   * removed. Zero them rather than leaving last week's number standing —
   * their earned badges are safe in the ledger either way.
   */
  if (rows.length > 0) {
    await admin
      .from("community_message_counts")
      .update({ messages: 0, counted_at: nowIso })
      .lt("counted_at", nowIso);
  }

  return { members: rows.length, messages, channels, truncated };
}
