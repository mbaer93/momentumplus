import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  generateSummary,
  isAnthropicConfigured,
  SUMMARY_MODEL,
} from "@/lib/ai-summary";

/*
 * AI summaries cron (SPEC.md §4, /api/cron/summaries). For completed sessions
 * without a summary: transcript → Claude → ai_summaries. Zoom cloud-recording
 * transcript fetch arrives with the recording pipeline; until then, transcripts
 * are supplied via the admin regenerate endpoint below (POST with transcript),
 * and this cron reports what is waiting.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();
  const { data: pending, error } = await admin
    .from("sessions")
    .select("id, title, ai_summaries ( id )")
    .eq("status", "completed");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const waiting = (pending ?? []).filter(
    (s) => !(s as unknown as { ai_summaries: unknown }).ai_summaries,
  );

  return NextResponse.json({
    ok: true,
    anthropicConfigured: isAnthropicConfigured(),
    awaitingTranscript: waiting.map((s) => ({ id: s.id, title: s.title })),
  });
}

/*
 * Admin: generate (or regenerate) a summary from a supplied transcript.
 * Body: { sessionId: string, transcript: string }
 * Admin can review/edit before members see it (summary is visible only once
 * the session is completed, per RLS).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 },
    );
  }

  let body: { sessionId?: string; transcript?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.sessionId || !body.transcript) {
    return NextResponse.json(
      { error: "sessionId and transcript required" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data: session } = await admin
    .from("sessions")
    .select("id, title, speakers ( name )")
    .eq("id", body.sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const speakerName =
    (session as unknown as { speakers: { name: string } | null }).speakers
      ?.name ?? "the speaker";

  const summary = await generateSummary(
    body.transcript,
    session.title,
    speakerName,
  );
  if (!summary) {
    return NextResponse.json(
      { error: "Model did not return a parseable summary" },
      { status: 502 },
    );
  }

  const { error } = await admin.from("ai_summaries").upsert(
    {
      session_id: session.id,
      takeaways: summary.takeaways,
      quotes: summary.quotes,
      action_items: summary.action_items,
      highlights: summary.highlights,
      model: SUMMARY_MODEL,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "session_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, summary });
}
