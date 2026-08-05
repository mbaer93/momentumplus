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
/* Back-catalog import (Matt, 2026-08-05: "pull all past episodes")    */
/*                                                                     */
/* The public feed stops at ~15 uploads, so the importer walks the     */
/* channel's Videos tab instead: the page HTML carries the first batch */
/* of video ids plus an innertube key + continuation token, and the    */
/* browse endpoint pages through the rest — no API key of our own.     */
/* Per-episode metadata (title, full show notes, exact publish date)   */
/* comes from each video's watch page. Scraping is inherently fragile, */
/* so every parser degrades to "fewer episodes found", never a throw.  */
/* ------------------------------------------------------------------ */

/** All 11-char video ids in a chunk of YouTube page/browse JSON-ish text,
    first-seen order preserved (the Videos tab lists newest first). */
export function extractVideoIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // \s* : the page HTML embeds minified JSON but the browse API pretty-prints.
  const re = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/** The continuation token that fetches the next page of the Videos tab. */
export function extractContinuationToken(text: string): string | null {
  return (
    text.match(
      /"continuationCommand"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/,
    )?.[1] ?? null
  );
}

/** One video as listed on the channel's Videos tab. */
export interface BrowseVideo {
  videoId: string;
  title: string;
  /** Truncated (~130 chars) — the watch page has the full notes when
      YouTube lets us read it. */
  snippet: string;
  /** Relative, e.g. "2 years ago" — exact dates need the watch page. */
  publishedText: string | null;
}

/** Recursively collect video entries from parsed browse JSON /
    ytInitialData. Handles BOTH renderer generations (verified live,
    2026-08): the current `lockupViewModel` (contentId + title.content +
    "N days ago" metadata part) and the classic `videoRenderer` (videoId +
    title.runs + publishedTimeText). Missing fields degrade to empty. */
export function collectBrowseVideos(node: unknown): BrowseVideo[] {
  const out: BrowseVideo[] = [];
  const seen = new Set<string>();
  const push = (v: BrowseVideo) => {
    if (!seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push(v);
    }
  };
  const runsText = (v: unknown): string => {
    const o = v as
      | { simpleText?: string; content?: string; runs?: { text?: string }[] }
      | undefined;
    if (!o) return "";
    if (typeof o.simpleText === "string") return o.simpleText;
    if (typeof o.content === "string") return o.content;
    if (Array.isArray(o.runs)) {
      return o.runs.map((r) => r.text ?? "").join("");
    }
    return "";
  };
  const agoText = (n: unknown): string | null => {
    // Depth-first hunt for any "… ago" string in the item's metadata.
    if (typeof n === "string") return /\bago\b/i.test(n) ? n : null;
    if (Array.isArray(n)) {
      for (const item of n) {
        const hit = agoText(item);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof n === "object" && n !== null) {
      for (const value of Object.values(n)) {
        const hit = agoText(value);
        if (hit) return hit;
      }
    }
    return null;
  };
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n !== "object" || n === null) return;
    const o = n as Record<string, unknown>;

    // Current shape: lockupViewModel.
    const contentId = o.contentId;
    if (
      typeof contentId === "string" &&
      /^[A-Za-z0-9_-]{11}$/.test(contentId) &&
      typeof o.contentType === "string" &&
      o.contentType.includes("VIDEO") &&
      o.metadata !== undefined
    ) {
      const meta = (o.metadata as { lockupMetadataViewModel?: unknown })
        .lockupMetadataViewModel as Record<string, unknown> | undefined;
      push({
        videoId: contentId,
        title: runsText(meta?.title).trim(),
        snippet: "",
        publishedText: agoText(meta),
      });
    }

    // Classic shape: videoRenderer / gridVideoRenderer.
    const videoId = o.videoId;
    if (
      typeof videoId === "string" &&
      /^[A-Za-z0-9_-]{11}$/.test(videoId) &&
      (o.title !== undefined || o.headline !== undefined)
    ) {
      const metaSnippet = Array.isArray(o.detailedMetadataSnippets)
        ? (o.detailedMetadataSnippets[0] as { snippetText?: unknown } | undefined)
            ?.snippetText
        : undefined;
      push({
        videoId,
        title: runsText(o.title ?? o.headline).trim(),
        snippet: runsText(o.descriptionSnippet ?? metaSnippet).trim(),
        publishedText: runsText(o.publishedTimeText).trim() || null,
      });
    }
    for (const value of Object.values(o)) walk(value);
  };
  walk(node);
  return out;
}

/** Approximate ISO timestamp from YouTube's relative "2 years ago" text.
    Only for back-catalog ordering when the exact date is unreachable —
    the day-level number is a floor, not a fact. */
export function approxDateFromRelative(
  text: string,
  nowMs: number,
): string | null {
  const m = text
    .toLowerCase()
    .match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const n = Number(m[1]);
  const UNIT_MS: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  return new Date(nowMs - n * UNIT_MS[m[2]]).toISOString();
}

/** The ytInitialData JSON embedded in a channel page. */
export function extractInitialData(html: string): unknown {
  const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export interface WatchPageMeta {
  title: string;
  showNotes: string;
  /** ISO date ("2025-11-12" or full timestamp) when YouTube exposes it. */
  uploadDate: string | null;
}

/** Title, full description, and exact upload date from a watch page. */
export function parseWatchPageMeta(html: string): WatchPageMeta {
  const title = decodeXml(
    html.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? "",
  ).trim();
  let showNotes = "";
  const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (desc) {
    try {
      showNotes = (JSON.parse(`"${desc}"`) as string).trim();
    } catch {
      /* malformed escape — leave notes empty */
    }
  }
  const uploadDate = html.match(/"uploadDate":"([^"]+)"/)?.[1] ?? null;
  return { title, showNotes, uploadDate };
}

const BROWSE_HEADERS = {
  "content-type": "application/json",
  // A consent cookie keeps YouTube from bouncing EU-routed requests to the
  // consent interstitial (harmless elsewhere).
  cookie: "CONSENT=YES+1",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

/** The Videos-tab browse params (a fixed protobuf constant YouTube's own
    web client sends — selects the Videos tab, latest first). */
const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";

/** Every video on the channel, newest first, with title/snippet/relative
    date — the Videos tab via the browse endpoint plus pagination. Caps at
    30 pages (~900 videos). Verified live against real channels. */
export async function listAllChannelVideos(
  channelId: string,
): Promise<{ videos: BrowseVideo[]; note?: string }> {
  // The channel page supplies the innertube key + client version the
  // browse endpoint wants.
  const pageRes = await fetch(
    `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos?hl=en`,
    { cache: "no-store", headers: BROWSE_HEADERS },
  );
  if (!pageRes.ok) {
    return { videos: [], note: `Channel page fetch failed (${pageRes.status})` };
  }
  const html = await pageRes.text();
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion =
    html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] ??
    html.match(/"clientVersion":"([^"]+)"/)?.[1] ??
    "2.20240101.00.00";

  const videos: BrowseVideo[] = [];
  const have = new Set<string>();
  const absorb = (found: BrowseVideo[]) => {
    for (const v of found) {
      if (!have.has(v.videoId)) {
        have.add(v.videoId);
        videos.push(v);
      }
    }
  };

  const browse = async (body: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/browse${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`,
        {
          method: "POST",
          cache: "no-store",
          headers: BROWSE_HEADERS,
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion, hl: "en" } },
            ...body,
          }),
        },
      );
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  };

  // Page 1: the Videos tab itself (the /videos HTML sometimes lands on the
  // Featured tab, whose entries and continuation are the wrong list).
  const first = await browse({
    browseId: channelId,
    params: VIDEOS_TAB_PARAMS,
  });
  let token: string | null = null;
  if (first) {
    try {
      absorb(collectBrowseVideos(JSON.parse(first)));
    } catch {
      absorb(collectBrowseVideos(null));
    }
    token = extractContinuationToken(first);
  }
  // Fall back to whatever the HTML carried if the browse call failed.
  if (videos.length === 0) {
    absorb(collectBrowseVideos(extractInitialData(html)));
    token = token ?? extractContinuationToken(html);
    if (videos.length === 0) {
      return {
        videos: [],
        note: "Couldn't read the channel's video list — check the channel id",
      };
    }
  }

  let pages = 0;
  while (token && pages < 30) {
    pages++;
    const text = await browse({ continuation: token });
    if (!text) break;
    const before = videos.length;
    try {
      absorb(collectBrowseVideos(JSON.parse(text)));
    } catch {
      break;
    }
    token = extractContinuationToken(text);
    if (videos.length === before) break; // no progress — stop rather than spin
  }
  return { videos };
}

/** Fetch one video's metadata from its watch page, oEmbed as fallback. */
export async function fetchVideoMeta(videoId: string): Promise<WatchPageMeta> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
      { cache: "no-store", headers: BROWSE_HEADERS },
    );
    if (res.ok) {
      const meta = parseWatchPageMeta(await res.text());
      if (meta.title) return meta;
    }
  } catch {
    /* fall through to oEmbed */
  }
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const title = ((await res.json()) as { title?: string }).title ?? "";
      return { title, showNotes: "", uploadDate: null };
    }
  } catch {
    /* give up gracefully */
  }
  return { title: "", showNotes: "", uploadDate: null };
}

/** Import the channel's entire back catalog. Every episode gets at least
    the channel-listing metadata (full title, notes snippet, approximate
    date — enough to browse and play); we then TRY to enrich each with the
    full show notes and exact date from its watch page, which YouTube
    sometimes bot-walls for server IPs — an episode that can't be enriched
    still imports. The recent ~15 get exact data from the feed. Existing
    episodes are never touched; the whole run is time-budgeted, so a second
    press resumes where the first stopped. */
export async function importBackCatalog(): Promise<{
  ok: boolean;
  imported: number;
  remaining: number;
  total: number;
  message?: string;
}> {
  const { channelId } = await readPodcastSettings();
  if (!channelId) {
    return {
      ok: false,
      imported: 0,
      remaining: 0,
      total: 0,
      message: "Save the channel first",
    };
  }
  const { videos, note } = await listAllChannelVideos(channelId);
  if (videos.length === 0) {
    return {
      ok: false,
      imported: 0,
      remaining: 0,
      total: 0,
      message: note ?? "No videos found on the channel — check the channel id",
    };
  }

  // The feed's most-recent entries carry FULL notes and exact dates — use
  // them wherever they overlap the catalog.
  const feedById = new Map<string, FeedEntry>();
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      for (const e of parseYoutubeFeed(await res.text())) {
        feedById.set(e.videoId, e);
      }
    }
  } catch {
    /* feed unavailable — listing metadata still suffices */
  }

  const admin = createServiceClient();
  // Existing ids in chunks — one giant .in() overflows the request URL.
  const have = new Set<string>();
  for (let i = 0; i < videos.length; i += 100) {
    const { data } = await admin
      .from("podcast_episodes")
      .select("youtube_video_id")
      .in(
        "youtube_video_id",
        videos.slice(i, i + 100).map((v) => v.videoId),
      );
    for (const r of (data ?? []) as { youtube_video_id: string }[]) {
      have.add(r.youtube_video_id);
    }
  }
  const fresh = videos.filter((v) => !have.has(v.videoId));

  const budgetStart = Date.now();
  const BUDGET_MS = 240_000;
  let imported = 0;
  let remaining = 0;
  let lastError: string | null = null;
  for (const video of fresh) {
    if (Date.now() - budgetStart > BUDGET_MS) {
      remaining++;
      continue;
    }
    const feed = feedById.get(video.videoId);
    let title = feed?.title || video.title;
    let showNotes = feed?.showNotes || "";
    let publishedAt = feed?.publishedAt ?? null;
    if (!feed) {
      // Enrichment attempt — full notes + exact date when YouTube serves
      // the watch page to us; harmless failure otherwise.
      const meta = await fetchVideoMeta(video.videoId);
      if (meta.title) title = meta.title;
      showNotes = meta.showNotes || video.snippet;
      publishedAt = meta.uploadDate
        ? new Date(
            meta.uploadDate.includes("T")
              ? meta.uploadDate
              : `${meta.uploadDate}T12:00:00Z`,
          ).toISOString()
        : video.publishedText
          ? approxDateFromRelative(video.publishedText, Date.now())
          : null;
    }
    const { error } = await admin.from("podcast_episodes").upsert(
      {
        youtube_video_id: video.videoId,
        title: title || "Untitled episode",
        show_notes: showNotes,
        thumbnail_url: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
        published_at: publishedAt,
        source: "auto",
      },
      { onConflict: "youtube_video_id", ignoreDuplicates: true },
    );
    if (error) lastError = error.message;
    else imported++;
  }

  const parts = [
    `${imported} episode${imported === 1 ? "" : "s"} imported (${videos.length} on the channel, ${have.size} already in).`,
  ];
  if (remaining > 0) {
    parts.push(`${remaining} still to import — press Import again to continue.`);
  }
  if (lastError) parts.push(`Last error: ${lastError}.`);
  return {
    ok: !lastError,
    imported,
    remaining,
    total: videos.length,
    message: parts.join(" "),
  };
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
