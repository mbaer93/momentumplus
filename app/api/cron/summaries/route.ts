import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  generateSummary,
  SUMMARY_MODEL,
} from "@/lib/ai-summary";
import {
  fetchMuxTranscript,
  generateMuxPlaybackToken,
  getMuxAsset,
  isMuxConfigured,
  isMuxSigningConfigured,
  requestMuxAutoCaptions,
} from "@/lib/mux";
import { isAnthropicReady } from "@/lib/service-config";

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

  // Uploaded Library videos: request Mux auto-captions, and once the
  // transcript is ready run it through Claude (max a few per run).
  const videoResults: { id: string; title: string; status: string }[] = [];
  const anthropicReady = await isAnthropicReady();
  if (isMuxConfigured()) {
    const { data: videos } = await admin
      .from("videos")
      .select(
        "id, title, mux_asset_id, mux_playback_id, duration_sec, ai_summaries!video_id ( id )",
      )
      .not("mux_asset_id", "is", null)
      .limit(50);

    // Backfill: an upload finalized while Mux was still "preparing" gets a
    // row with no playback id/duration and would otherwise show "Recording
    // processing" forever. Heal those here once the asset is ready.
    for (const v of (videos ?? []).filter(
      (v) => !v.mux_playback_id || !v.duration_sec,
    )) {
      try {
        const asset = await getMuxAsset(v.mux_asset_id as string);
        const playbackId = asset.playback_ids?.[0]?.id ?? null;
        const patch: Record<string, unknown> = {};
        if (!v.mux_playback_id && playbackId) patch.mux_playback_id = playbackId;
        if (!v.duration_sec && asset.duration) {
          patch.duration_sec = Math.round(asset.duration);
        }
        if (Object.keys(patch).length > 0) {
          await admin.from("videos").update(patch).eq("id", v.id);
          if (patch.mux_playback_id) v.mux_playback_id = patch.mux_playback_id;
          videoResults.push({ id: v.id, title: v.title, status: "playback backfilled" });
        }
      } catch {
        // asset may still be processing; next run retries
      }
    }

    const candidates = (videos ?? [])
      .filter((v) => {
        const s = (v as unknown as { ai_summaries: unknown }).ai_summaries;
        return !s || (Array.isArray(s) && s.length === 0);
      })
      .slice(0, 3);

    for (const video of candidates) {
      try {
        const asset = await getMuxAsset(video.mux_asset_id as string);
        const tracks = asset.tracks ?? [];
        const textTrack = tracks.find(
          (t) => t.type === "text" && t.status === "ready",
        );

        if (!textTrack) {
          const audio = tracks.find((t) => t.type === "audio");
          const hasText = tracks.some((t) => t.type === "text");
          if (audio && !hasText) {
            await requestMuxAutoCaptions(asset.id, audio.id);
            videoResults.push({ id: video.id, title: video.title, status: "captions requested" });
          } else {
            videoResults.push({ id: video.id, title: video.title, status: "captions processing" });
          }
          continue;
        }

        if (!anthropicReady) {
          videoResults.push({ id: video.id, title: video.title, status: "transcript ready — connect Anthropic" });
          continue;
        }

        const token =
          video.mux_playback_id && isMuxSigningConfigured()
            ? generateMuxPlaybackToken(video.mux_playback_id as string)
            : null;
        const transcript = video.mux_playback_id
          ? await fetchMuxTranscript(
              video.mux_playback_id as string,
              textTrack.id,
              token,
            )
          : null;
        if (!transcript) {
          videoResults.push({ id: video.id, title: video.title, status: "transcript unavailable" });
          continue;
        }

        const summary = await generateSummary(
          transcript,
          video.title,
          "the speaker",
        );
        if (!summary) {
          videoResults.push({ id: video.id, title: video.title, status: "model returned no summary" });
          continue;
        }
        const { error: upsertError } = await admin.from("ai_summaries").upsert(
          {
            video_id: video.id,
            takeaways: summary.takeaways,
            quotes: summary.quotes,
            action_items: summary.action_items,
            highlights: summary.highlights,
            model: SUMMARY_MODEL,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "video_id" },
        );
        videoResults.push({
          id: video.id,
          title: video.title,
          status: upsertError ? upsertError.message : "summary generated",
        });
      } catch (e) {
        videoResults.push({
          id: video.id,
          title: video.title,
          status: `error: ${(e as Error).message}`,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    anthropicConfigured: anthropicReady,
    awaitingTranscript: waiting.map((s) => ({ id: s.id, title: s.title })),
    videos: videoResults,
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
  if (!(await isAnthropicReady())) {
    return NextResponse.json(
      { error: "Anthropic is not connected (Admin → Connections)" },
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
