import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/current-member";
import { getAnthropicApiKey } from "@/lib/service-config";
import { createClient } from "@/lib/supabase/server";
import { allowAction } from "@/lib/throttle";
import {
  extractReplyText,
  isSendableHistory,
  sanitizeChatHistory,
  type ChatMessage,
} from "@/lib/help-chat";

/*
 * AI help chat: answers member questions about using Momentum+. Runs on the
 * platform's Anthropic key (Admin → Connections). It only explains the
 * product — it has no access to member data, billing, or admin actions.
 */

export const dynamic = "force-dynamic";

const HELP_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the Momentum+ help assistant. Momentum+ is a national members-only community and learning platform for business leaders, built by the team behind the Tri-State Leadership Summit (TSLS). Members join from anywhere — never describe it as regional.

Answer questions about how to use the platform, concisely and warmly. Plain language, no emoji, no markdown headers. Keep answers short — a few sentences unless steps are needed.

What's where (left sidebar navigation):
- Dashboard: stats, upcoming sessions, recent community activity.
- Sessions: live monthly sessions. Members enroll on a session's page; enrolled members see "Join Session Now" when it's live (Zoom, right inside the page). "Add to calendar" downloads a calendar invite. Each session page has private notes only that member can see.
- Calendar: month view of all upcoming sessions and events.
- Library: recordings of past sessions. Cards show duration; some recordings are exclusive to Pro members. Each video has AI-generated key takeaways and private notes.
- Education: self-paced courses made of lessons (video, reading, documents, sometimes a short test). Completing every lesson (and passing each lesson test with 75% or better) earns a printable certificate of completion showing educational hours. Certificates also live under Profile → My Certificates.
- Community: live group chat channels with other members (Pro members, speakers, and sponsors get extra premium channels).
- Speakers: speaker profiles from sessions.
- Resources: downloadable tools and partner resources.
- Profile (top-right avatar or sidebar): personal info, session history, My Certificates tab, notification preferences, and billing. Members manage their subscription with the "Manage billing" button on Profile when billing is enabled.

Membership levels: Momentum+ Member (paid Basic access), Gift (free Basic for 1 month), VIP Access (free Basic-level for 3 months — VIP Access does NOT unlock exclusive/Pro content), Pro (everything, including Pro-only sessions, videos, courses, and resources), Sponsor (runs a sponsor page; Pro-equivalent access), and Speaker.

Rules:
- You cannot see or change any member's account, payments, or data. For account-specific problems (login trouble, billing disputes, wrong membership level), tell them to contact the TSLS team through the Community chat or their welcome email.
- If asked something unrelated to Momentum+/TSLS, politely steer back to the platform.
- Never invent features. If you're not sure something exists, say you're not sure and point them to the closest real feature.`;

export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member || !member.membershipActive) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  // Durable 20-requests/hour cap (action_events, migration 0071). The old
  // in-process Map reset on every cold start and never saw sibling
  // serverless instances, so the paid-API cap was advisory.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (user && !(await allowAction(user.id, "help_chat", 20, 3600_000))) {
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
  const history = sanitizeChatHistory(body.messages);
  if (!isSendableHistory(history)) {
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
    const reply = extractReplyText(await res.json());
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
