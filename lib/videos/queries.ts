import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import { isMuxConfigured, muxThumbnailUrl } from "@/lib/mux";
import { seasonInScope, seasonOf } from "@/lib/season";
import { mapTopicRows } from "@/lib/topics";
import { getAccessMatrix, libraryScopeFor, type LibraryScope } from "@/lib/tiers";
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
  season?: number | null;
  video_topics?: unknown;
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
    category: row.category ?? "",
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
    topics: mapTopicRows(row.video_topics),
    // No explicit season means "date it by when it was published", the same
    // coalesce library_season_ok() does in SQL.
    season: row.season ?? seasonOf(row.published_at),
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
  "id, title, category, season, video_topics ( is_primary, content_topics ( id, name, slug ) ), mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ), ai_summaries ( takeaways, quotes, action_items, highlights, model, generated_at ) ), ai_summaries!video_id ( takeaways, quotes, action_items, highlights, model, generated_at )";

const VIDEO_SELECT_LEGACY =
  "id, title, category, mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ), ai_summaries ( takeaways, quotes, action_items, highlights, model, generated_at ) ), ai_summaries!video_id ( takeaways, quotes, action_items, highlights, model, generated_at )";

// List view: no AI summaries — nothing on the grid renders them, and the
// full summaries added 1-3 KB of dead RSC payload per video per view.
const VIDEO_LIST_SELECT =
  "id, title, category, season, video_topics ( is_primary, content_topics ( id, name, slug ) ), mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ) )";

/* Everything 0055 added, dropped when running against a database that hasn't
   had it yet — an un-migrated environment should show a library, not a 500. */
const VIDEO_LIST_SELECT_LEGACY =
  "id, title, category, mux_playback_id, thumbnail_url, duration_sec, min_access, published_at, session_id, sessions ( speakers ( name ) )";

export async function listVideos(viewerTier: Tier): Promise<VideoItem[]> {
  if (!isSupabaseConfigured()) {
    // Preview: show all, marking the ones out of reach as locked teasers.
    const scope = libraryScopeFor(await getAccessMatrix(), viewerTier);
    return placeholderVideos.map((v) => {
      const tierOk = canAccess(viewerTier, v.minAccess);
      const seasonOk = seasonInScope(scope, v.season);
      const open = tierOk && seasonOk;
      return {
        ...v,
        locked: !open,
        lockReason: tierOk ? ("season" as const) : ("tier" as const),
        muxPlaybackId: open ? v.muxPlaybackId : null,
      };
    });
  }
  const supabase = await createClient();
  // Archived items (speaker archived with their season) stay out of the
  // library without being deleted.
  // Newest 200 (audit P2-16): years of headroom at the current publish
  // rate, and it bounds BOTH library scans — this one and the teaser scan
  // below — instead of a double full-table read on every visit.
  const LIBRARY_LIMIT = 200;
  const res = await supabase
    .from("videos")
    .select(VIDEO_LIST_SELECT)
    .is("archived_at", null)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(LIBRARY_LIMIT);
  let { data, error } = res;
  if (error && /season|video_topics|content_topics/.test(error.message)) {
    // Pre-migration fallback: topics and season arrive with 0055.
    ({ data, error } = (await supabase
      .from("videos")
      .select(VIDEO_LIST_SELECT_LEGACY)
      .is("archived_at", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(LIBRARY_LIMIT)) as unknown as typeof res);
  }
  if (error && error.message.includes("archived_at")) {
    // Pre-migration fallback: the column arrives with migration 0028.
    ({ data, error } = (await supabase
      .from("videos")
      .select(VIDEO_LIST_SELECT_LEGACY)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(LIBRARY_LIMIT)) as unknown as typeof res);
  }
  // An outage is not an empty library — surface it to the error boundary.
  if (error) throw new Error(`Couldn't load the library: ${error.message}`);
  const accessible = (data as unknown as VideoRow[] | null)?.map(mapRow) ?? [];
  const teasers = await lockedVideoTeasers(
    new Set(accessible.map((v) => v.id)),
    libraryScopeFor(await getAccessMatrix(), viewerTier),
  );
  return [...accessible, ...teasers];
}

/*
 * Above-tier recordings are hidden from under-tier members at the RLS layer,
 * so a Basic member never learns Pro content exists. Fetch published videos'
 * METADATA ONLY (never the Mux playback id) through the service role and
 * append locked teaser cards — the upsell — for any the member can't see.
 */
async function lockedVideoTeasers(
  visibleIds: Set<string>,
  scope: LibraryScope,
): Promise<VideoItem[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    // Deliberately NO mux_playback_id — a teaser must not be playable.
    let res = await createServiceClient()
      .from("videos")
      .select(
        "id, title, category, season, video_topics ( is_primary, content_topics ( id, name, slug ) ), thumbnail_url, duration_sec, min_access, published_at, sessions ( speakers ( name ) )",
      )
      .is("archived_at", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(200);
    if (res.error) {
      // Pre-0055: no season, no topics. Teasers still work without them.
      res = (await createServiceClient()
        .from("videos")
        .select(
          "id, title, category, thumbnail_url, duration_sec, min_access, published_at, sessions ( speakers ( name ) )",
        )
        .is("archived_at", null)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(200)) as typeof res;
    }
    return ((res.data as unknown as VideoRow[] | null) ?? [])
      .filter((row) => !visibleIds.has(row.id))
      .map((row) => {
        const item = mapRow(row);
        // Two reasons a recording can be out of reach, and the card says
        // which: above the member's tier, or from a season they don't get.
        const outOfSeason = !seasonInScope(scope, item.season);
        return {
          ...item,
          muxPlaybackId: null,
          locked: true,
          lockReason: outOfSeason ? ("season" as const) : ("tier" as const),
        };
      });
  } catch {
    return [];
  }
}

export async function getVideo(
  id: string,
  viewerTier: Tier,
): Promise<VideoItem | null> {
  if (!isSupabaseConfigured()) {
    const v = placeholderVideos.find((x) => x.id === id) ?? null;
    return v && canAccess(viewerTier, v.minAccess) ? v : null;
  }
  const supabase = await createClient();
  const first = await supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  let { data, error } = first;
  if (error && /season|video_topics|content_topics/.test(error.message)) {
    // Pre-0055: same row, without topics or season.
    ({ data, error } = (await supabase
      .from("videos")
      .select(VIDEO_SELECT_LEGACY)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()) as unknown as typeof first);
  }
  if (error && error.message.includes("archived_at")) {
    // Pre-migration fallback: the column arrives with migration 0028.
    ({ data, error } = (await supabase
      .from("videos")
      .select(VIDEO_SELECT_LEGACY)
      .eq("id", id)
      .maybeSingle()) as unknown as typeof first);
  }
  if (error || !data) return null;
  return mapRow(data as unknown as VideoRow);
}
