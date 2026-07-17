import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { getAnthropicApiKey } from "@/lib/service-config";

/*
 * AI help chat: answers member questions about using Momentum+. Runs on the
 * platform's Anthropic key (Admin → Connections). It only explains the
 * product — it has no access to member data, billing, or admin actions.
 */

export const dynamic = "force-dynamic";

// Best-effort per-user throttle (per server instance): 20 requests/hour.
const usage = new Map<string, number[]>();
function overLimit(key: string): boolean {
  const now = Date.now();
  const recent = (usage.get(key) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 20) {
    usage.set(key, recent);
    return true;
  }
  recent.push(now);
  usage.set(key, recent);
  return false;
}

const HELP_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the Momentum+ help assistant. Momentum+ is the members-only community and learning platform of the Tri-State Leadership Summit (TSLS), for business leaders in Maryland, Pennsylvania, and West Virginia.

Answer questions about how to use the platform, concisely and warmly. Plain language, no emoji, no markdown headers. Keep answers short — a few sentences unless steps are needed.

What's where (left sidebar navigation):
- Dashboard: stats, upcoming sessions, recent community activity.
- Sessions: live monthly sessions. Members enroll on a session's page; enrolled members see "Join Session Now" when it's live (Zoom, right inside the page). "Add to calendar" downloads a calendar invite. Each session page has private notes only that member can see.
- Calendar: month view of all upcoming sessions and events.
- Library: recordings of past sessions. Cards show duration; some recordings are VIP or Pro only. Each video has AI-generated key takeaways and private notes.
- Education: self-paced courses made of lessons (video, reading, documents, sometimes a short test). Completing every lesson (and passing each lesson test with 75% or better) earns a printable certificate of completion showing educational hours. Certificates also live under Profile → My Certificates.
- Community: live group chat channels with other members (VIP members get an extra VIP channel).
- Speakers: speaker profiles from sessions.
- Resources: downloadable tools and partner resources.
- Profile (top-right avatar or sidebar): personal info, session history, My Certificates tab, notification preferences, and billing. Members manage their subscription with the "Manage billing" button on Profile when billing is enabled.

Membership levels: Basic (paid), Gift (free Basic for 1 month), VIP (free Basic-level for 3 months), and Pro (everything, including Pro-only sessions, videos, courses, and resources). Sponsors receive Pro access.

Rules:
- You cannot see or change any member's account, payments, or data. For account-specific problems (login trouble, billing disputes, wrong membership level), tell them to contact the TSLS team through the Community chat or their welcome email.
- If asked something unrelated to Momentum+/TSLS, politely steer back to the platform.
- Never invent features. If you're not sure something exists, say you're not sure and point them to the closest real feature.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (overLimit(member.email || member.name)) {
    return NextResponse.json({
      reply:
        "You've reached the helper's hourly limit — give it a little while and ask again, or post in the Community chat.",
    });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter(
      (m): m is ChatMessage =>
        Boolean(m) &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send a message first." }, { status: 400 });
  }

  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    return NextResponse.json({
      reply:
        "The AI helper isn't connected yet — an admin can turn it on in Admin → Connections → Anthropic. In the meantime, ask your question in the Community chat and the TSLS team will help.",
    });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HELP_MODEL,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "The helper hit a snag — try again in a moment." },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const reply = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({
      reply: reply || "Sorry — I didn't catch that. Could you rephrase?",
    });
  } catch {
    return NextResponse.json(
      { error: "The helper hit a snag — try again in a moment." },
      { status: 502 },
    );
  }
}
