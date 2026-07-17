import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import { isMuxConfigured, muxThumbnailUrl } from "@/lib/mux";
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

interface SummaryRow {
  takeaways: unknown;
  quotes: unknown;
  action_items: unknown;
  highlights: string | null;
  model: string | null;
  generated_at: string | null;
}

interface VideoRow {
  id: string;
  title: string;
  category: string | null;
  mux_playback_id: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  min_access: VideoItem["minAccess"];
  published_at: string | null;
  session_id: string | null;
  sessions: {
    speakers: { name: string } | null;
    ai_summaries: SummaryRow | null;
  } | null;
  /** Summaries attached directly to the video (uploaded recordings). */
  ai_summaries: SummaryRow | SummaryRow[] | null;
}

function mapRow(row: VideoRow): VideoItem {
  const direct = Array.isArray(row.ai_summaries)
    ? (row.ai_summaries[0] ?? null)
    : row.ai_summaries;
  const ai = row.sessions?.ai_summaries ?? direct;
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
    // Uploaded thumbnail wins; otherwise Mux's screen grab from the video.
    thumbnailUrl:
      row.thumbnail_url ??
      (row.mux_playback_id && isMuxConfigured()
        ? muxThumbnailUrl(row.mux_playback_id)
        : null),
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
  "id, title, category, mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ), ai_summaries ( takeaways, quotes, action_items, highlights, model, generated_at ) ), ai_summaries!video_id ( takeaways, quotes, action_items, highlights, model, generated_at )";

// List view: no AI summaries — nothing on the grid renders them, and the
// full summaries added 1-3 KB of dead RSC payload per video per view.
const VIDEO_LIST_SELECT =
  "id, title, category, mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ) )";

export async function listVideos(viewerTier: Tier): Promise<VideoItem[]> {
  if (!isSupabaseConfigured()) {
    return placeholderVideos.filter((v) => canAccess(viewerTier, v.minAccess));
  }
  const supabase = createClient();
  // Archived items (speaker archived with their season) stay out of the
  // library without being deleted.
  let { data, error } = await supabase
    .from("videos")
    .select(VIDEO_LIST_SELECT)
    .is("archived_at", null)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false });
  if (error && error.message.includes("archived_at")) {
    // Pre-migration fallback: the column arrives with migration 0028.
    ({ data, error } = await supabase
      .from("videos")
      .select(VIDEO_LIST_SELECT)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false }));
  }
  // An outage is not an empty library — surface it to the error boundary.
  if (error) throw new Error(`Couldn't load the library: ${error.message}`);
  if (!data) return [];
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
  let { data, error } = await supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error && error.message.includes("archived_at")) {
    // Pre-migration fallback: the column arrives with migration 0028.
    ({ data, error } = await supabase
      .from("videos")
      .select(VIDEO_SELECT)
      .eq("id", id)
      .maybeSingle());
  }
  if (error || !data) return null;
  return mapRow(data as unknown as VideoRow);
}
