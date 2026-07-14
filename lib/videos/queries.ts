import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import type { Tier } from "@/lib/types";
import { gradientFor, placeholderVideos, type VideoItem } from "./data";

/*
 * Library data access. RLS already hides videos above the viewer's access
 * level; the canAccess() filter here is a UI-consistency guard for preview
 * mode, where there is no database.
 */

function durationLabel(sec: number | null): string {
  if (!sec) return "";
  return `${Math.round(sec / 60)} min`;
}

interface VideoRow {
  id: string;
  title: string;
  category: string | null;
  mux_playback_id: string | null;
  duration_sec: number | null;
  min_access: VideoItem["minAccess"];
  published_at: string | null;
  session_id: string | null;
  sessions: {
    speakers: { name: string } | null;
    ai_summaries: {
      takeaways: unknown;
      quotes: unknown;
      action_items: unknown;
      highlights: string | null;
      model: string | null;
      generated_at: string | null;
    } | null;
  } | null;
}

function mapRow(row: VideoRow): VideoItem {
  const ai = row.sessions?.ai_summaries;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return {
    id: row.id,
    title: row.title,
    category: (row.category as VideoItem["category"]) ?? "Leadership",
    speakerName: row.sessions?.speakers?.name ?? "Momentum+ Speaker",
    durationLabel: durationLabel(row.duration_sec),
    dateLabel: row.published_at
      ? new Date(row.published_at).toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        })
      : "",
    gradient: gradientFor(row.id),
    minAccess: row.min_access,
    muxPlaybackId: row.mux_playback_id,
    sessionId: row.session_id,
    aiSummary: ai
      ? {
          takeaways: arr(ai.takeaways),
          quotes: arr(ai.quotes),
          actionItems: arr(ai.action_items),
          highlights: ai.highlights,
          model: ai.model,
          generatedAt: ai.generated_at,
        }
      : null,
  };
}

const VIDEO_SELECT =
  "id, title, category, mux_playback_id, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ), ai_summaries ( takeaways, quotes, action_items, highlights, model, generated_at ) )";

export async function listVideos(viewerTier: Tier): Promise<VideoItem[]> {
  if (!isSupabaseConfigured()) {
    return placeholderVideos.filter((v) => canAccess(viewerTier, v.minAccess));
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as VideoRow[]).map(mapRow);
}

export async function getVideo(
  id: string,
  viewerTier: Tier,
): Promise<VideoItem | null> {
  if (!isSupabaseConfigured()) {
    const v = placeholderVideos.find((x) => x.id === id) ?? null;
    return v && canAccess(viewerTier, v.minAccess) ? v : null;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as unknown as VideoRow);
}
