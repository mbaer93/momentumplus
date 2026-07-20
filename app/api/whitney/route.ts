import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { isPro } from "@/lib/access";
import { getAnthropicApiKey } from "@/lib/service-config";
import { getWhitneyPrompt, WHITNEY_MODEL } from "@/lib/whitney";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Whitney by SLC (Pro feature): one member message in, Whitney's reply out.
 * Conversations persist per member (whitney_conversations/_messages, RLS
 * read-own). The Pro gate is enforced HERE, server-side — the sidebar link
 * and page gate are conveniences, not the boundary. Nothing is stored until
 * Whitney actually replies, so a failed call can simply be retried.
 */

export const dynamic = "force-dynamic";
// The model call can take a while on long threads.
export const maxDuration = 60;

// Best-effort per-user throttle (per server instance): 40 messages/hour.
const usage = new Map<string, number[]>();
function overLimit(key: string): boolean {
  const now = Date.now();
  const recent = (usage.get(key) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 40) {
    usage.set(key, recent);
    return true;
  }
  recent.push(now);
  usage.set(key, recent);
  return false;
}

/** Messages of context sent to the model (a reflective thread stays short). */
const HISTORY_LIMIT = 40;
const MAX_MESSAGE_CHARS = 4000;

export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!isPro(member.tier)) {
    return NextResponse.json(
      { error: "Whitney is a Momentum+ Pro feature." },
      { status: 403 },
    );
  }
  if (overLimit(member.email || member.name)) {
    return NextResponse.json({
      reply:
        "You've reached Whitney's hourly limit. Take a pause — the conversation will be here when you come back.",
    });
  }

  let body: { conversationId?: string | null; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) {
    return NextResponse.json({ error: "Say something first." }, { status: 400 });
  }

  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    return NextResponse.json({
      reply:
        "Whitney isn't connected yet — an admin can turn her on in Admin → Connections → Anthropic.",
    });
  }

  // Preview mode (no database): converse without persistence.
  const persist =
    isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  let profileId: string | null = null;
  let conversationId = body.conversationId ?? null;
  const history: { role: "user" | "assistant"; content: string }[] = [];

  if (persist) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    profileId = user.id;

    const admin = createServiceClient();
    if (conversationId) {
      const { data: conv } = await admin
        .from("whitney_conversations")
        .select("id, profile_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv || conv.profile_id !== profileId) {
        return NextResponse.json(
          { error: "That conversation isn't yours." },
          { status: 403 },
        );
      }
      const { data: rows } = await admin
        .from("whitney_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      const recent = (rows ?? []).slice(-HISTORY_LIMIT);
      for (const r of recent) {
        if (r.role === "user" || r.role === "assistant") {
          history.push({
            role: r.role,
            content: (r.content as string).slice(0, MAX_MESSAGE_CHARS),
          });
        }
      }
    }
  }
  history.push({ role: "user", content: message });

  let reply = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: WHITNEY_MODEL,
        // Adaptive thinking is what stops the circling: Whitney privately
        // reviews the whole thread (what's been asked, what shifted) before
        // choosing her next question, instead of pattern-matching the last
        // message. Thinking shares max_tokens, so the cap leaves room for
        // it — her visible replies stay short by prompt design.
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        system: await getWhitneyPrompt(),
        messages: history,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Whitney hit a snag — try again in a moment." },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    reply = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch {
    return NextResponse.json(
      { error: "Whitney hit a snag — try again in a moment." },
      { status: 502 },
    );
  }
  if (!reply) {
    return NextResponse.json(
      { error: "Whitney had nothing to say — try rephrasing." },
      { status: 502 },
    );
  }

  // Persist only after a successful exchange — a failed call stores nothing,
  // so retrying never duplicates the member's message.
  if (persist && profileId) {
    const admin = createServiceClient();
    const nowIso = new Date().toISOString();
    if (!conversationId) {
      const { data: created, error } = await admin
        .from("whitney_conversations")
        .insert({
          profile_id: profileId,
          title: message.slice(0, 80),
        })
        .select("id")
        .single();
      if (error || !created) {
        // The reply still reaches the member; it just isn't saved.
        return NextResponse.json({ reply, conversationId: null });
      }
      conversationId = created.id as string;
    } else {
      await admin
        .from("whitney_conversations")
        .update({ updated_at: nowIso })
        .eq("id", conversationId);
    }
    // Explicit timestamps: both rows land in one insert, and identical
    // created_at values would make the thread's order ambiguous on reload.
    await admin.from("whitney_messages").insert([
      {
        conversation_id: conversationId,
        role: "user",
        content: message,
        created_at: nowIso,
      },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: reply,
        created_at: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
  }

  return NextResponse.json({ reply, conversationId });
}
