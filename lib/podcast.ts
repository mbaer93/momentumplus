import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Branching Out — the SLC podcast (Matt, 2026-08-05).
 *
 * The show is a video podcast published on YouTube (and Spotify); YouTube is
 * the sync source because its public per-channel feed carries everything the
 * tab needs — title, description (show notes), thumbnail, publish date —
 * with no API key. The sync cron upserts new uploads; admins add past
 * episodes manually (the feed only exposes the ~15 most recent).
 */

export interface PodcastEpisode {
  id: string;
  youtubeVideoId: string;
  title: string;
  showNotes: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  source: "auto" | "manual";
  hidden: boolean;
}

export interface PodcastSettings {
  /** UC… channel id the sync cron reads. Empty = sync disabled. */
  channelId: string;
}

export const PODCAST_SETTINGS_KEY = "podcast_settings";

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested in tests/podcast.test.ts)                 */
/* ------------------------------------------------------------------ */

/** Accepts any common YouTube URL shape (watch, youtu.be, shorts, embed,
    live) or a bare 11-char id, and returns the video id or null. */
export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const path = url.pathname.split("/").filter(Boolean);
    if (
      path.length >= 2 &&
      ["shorts", "embed", "live"].includes(path[0]) &&
      /^[A-Za-z0-9_-]{11}$/.test(path[1])
    ) {
      return path[1];
    }
  }
  return null;
}

export interface FeedEntry {
  videoId: string;
  title: string;
  showNotes: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Parse YouTube's public channel feed
    (https://www.youtube.com/feeds/videos.xml?channel_id=UC…). A targeted
    parser for the fixed fields the tab needs — not a general XML parser. */
export function parseYoutubeFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const blocks = xml.split(/<entry>/).slice(1);
  for (const block of blocks) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const description =
      block.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ??
      "";
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
    const thumb = block.match(/<media:thumbnail url="([^"]+)"/)?.[1];
    entries.push({
      videoId,
      title: decodeXml(title).trim(),
      showNotes: decodeXml(description).trim(),
      thumbnailUrl: thumb ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      publishedAt: published ?? null,
    });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

interface EpisodeRow {
  id: string;
  youtube_video_id: string;
  title: string;
  show_notes: string;
  thumbnail_url: string | null;
  published_at: string | null;
  source: string;
  hidden: boolean;
}

function toEpisode(row: EpisodeRow): PodcastEpisode {
  return {
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    title: row.title,
    showNotes: row.show_notes ?? "",
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    source: row.source === "manual" ? "manual" : "auto",
    hidden: Boolean(row.hidden),
  };
}

/** Newest first. Members never see hidden episodes; the admin page passes
    includeHidden to manage them. */
export async function listEpisodes(
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<PodcastEpisode[]> {
  if (!isSupabaseConfigured()) return placeholderEpisodes();
  const supabase = await createClient();
  let q = supabase
    .from("podcast_episodes")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (!includeHidden) q = q.eq("hidden", false);
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as EpisodeRow[]).map(toEpisode);
}

export async function readPodcastSettings(): Promise<PodcastSettings> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { channelId: "" };
  }
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", PODCAST_SETTINGS_KEY)
      .maybeSingle();
    const value = (data?.value ?? {}) as Partial<PodcastSettings>;
    return { channelId: value.channelId ?? "" };
  } catch {
    return { channelId: "" };
  }
}

/** Pull the channel feed and upsert episodes. Never overwrites an episode an
    admin already curated — only inserts new video ids. Returns counts. */
export async function syncFromYoutube(): Promise<{
  ok: boolean;
  added: number;
  seen: number;
  message?: string;
}> {
  const { channelId } = await readPodcastSettings();
  if (!channelId) {
    return { ok: false, added: 0, seen: 0, message: "No channel configured" };
  }
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    return {
      ok: false,
      added: 0,
      seen: 0,
      message: `Feed fetch failed (${res.status})`,
    };
  }
  const entries = parseYoutubeFeed(await res.text());
  if (entries.length === 0) {
    return { ok: true, added: 0, seen: 0, message: "Feed empty" };
  }
  const admin = createServiceClient();
  const { data: existing } = await admin
    .from("podcast_episodes")
    .select("youtube_video_id")
    .in(
      "youtube_video_id",
      entries.map((e) => e.videoId),
    );
  const have = new Set(
    ((existing ?? []) as { youtube_video_id: string }[]).map(
      (r) => r.youtube_video_id,
    ),
  );
  const fresh = entries.filter((e) => !have.has(e.videoId));
  if (fresh.length > 0) {
    const { error } = await admin.from("podcast_episodes").insert(
      fresh.map((e) => ({
        youtube_video_id: e.videoId,
        title: e.title || "Untitled episode",
        show_notes: e.showNotes,
        thumbnail_url: e.thumbnailUrl,
        published_at: e.publishedAt,
        source: "auto",
      })),
    );
    if (error) {
      return { ok: false, added: 0, seen: entries.length, message: error.message };
    }
  }
  return { ok: true, added: fresh.length, seen: entries.length };
}

/* ------------------------------------------------------------------ */
/* Preview-mode placeholders                                           */
/* ------------------------------------------------------------------ */

function placeholderEpisodes(): PodcastEpisode[] {
  const DAY = 24 * 60 * 60 * 1000;
  return [
    {
      id: "pe1",
      youtubeVideoId: "demo-ep-00002",
      title: "Branching Out — Growing Leaders Where They're Planted",
      showNotes:
        "Sierra sits down with a TSLS speaker to talk about growing leadership from the roots up: the habits that compound, the rooms that stretch you, and why community beats willpower.\n\nIn this episode:\n• The one weekly ritual every leader on the show swears by\n• How to ask for the room you need\n• This month's Momentum+ challenge",
      thumbnailUrl: null,
      publishedAt: new Date(Date.now() - 3 * DAY).toISOString(),
      source: "auto",
      hidden: false,
    },
    {
      id: "pe2",
      youtubeVideoId: "demo-ep-00001",
      title: "Branching Out — Why We Started This Show",
      showNotes:
        "The origin story: what the Tri-State Leadership Summit taught us about year-round growth, and what to expect from the show every week.",
      thumbnailUrl: null,
      publishedAt: new Date(Date.now() - 10 * DAY).toISOString(),
      source: "manual",
      hidden: false,
    },
  ];
}
