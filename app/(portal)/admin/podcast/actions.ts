"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  extractYoutubeVideoId,
  importBackCatalog,
  PODCAST_SETTINGS_KEY,
  syncFromYoutube,
} from "@/lib/podcast";

export interface PodcastActionResult {
  ok: boolean;
  message?: string;
}

const PREVIEW: PodcastActionResult = {
  ok: false,
  message: "Preview mode — connect Supabase to manage episodes.",
};

/** Save the channel the sync cron reads. Accepts a raw UC… id or a channel
    URL containing one. */
export async function savePodcastSettings(
  channelInput: string,
  spotifyInput = "",
): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const trimmed = channelInput.trim();
  const channelId =
    trimmed.match(/UC[A-Za-z0-9_-]{22}/)?.[0] ?? (trimmed === "" ? "" : null);
  if (channelId === null) {
    return {
      ok: false,
      message:
        "Enter the channel id (starts with UC…) — it's in the channel URL under youtube.com/channel/…",
    };
  }
  const spotifyUrl = spotifyInput.trim();
  if (spotifyUrl && !/^https:\/\/open\.spotify\.com\//.test(spotifyUrl)) {
    return {
      ok: false,
      message:
        "The Spotify link should be the show's open.spotify.com URL (copy it from Share on the show page).",
    };
  }
  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: PODCAST_SETTINGS_KEY,
      value: { channelId, spotifyUrl },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/podcast");
  revalidatePath("/branching-out");
  return { ok: true, message: "Settings saved" };
}

export async function syncPodcastNow(): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const result = await syncFromYoutube();
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return {
    ok: true,
    message: `${result.added} new episode${result.added === 1 ? "" : "s"} (${result.seen} in feed)`,
  };
}

/**
 * Import the ENTIRE back catalog (Matt, 2026-08-05: "pull all past
 * episodes — videos and info"). Walks the channel's full upload list (the
 * feed stops at ~15) and pulls each episode's title, full show notes,
 * exact publish date, and thumbnail. Existing episodes are never touched;
 * time-budgeted, so pressing again continues a large import.
 */
export async function importPodcastBackCatalog(): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const result = await importBackCatalog();
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return { ok: result.ok, message: result.message };
}

/** Manual route for past episodes the feed no longer exposes. Title/notes
    are optional — when blank we pull the title from YouTube's oEmbed
    endpoint (no API key) and leave notes empty for the admin to fill. */
export async function addEpisodeManual(values: {
  url: string;
  title: string;
  showNotes: string;
  publishedAt: string; // "YYYY-MM-DD" or ""
}): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const videoId = extractYoutubeVideoId(values.url);
  if (!videoId) {
    return { ok: false, message: "That doesn't look like a YouTube link" };
  }

  let title = values.title.trim();
  if (!title) {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`,
        )}&format=json`,
        { cache: "no-store" },
      );
      if (res.ok) {
        title = ((await res.json()) as { title?: string }).title ?? "";
      }
    } catch {
      /* fall through to the placeholder title */
    }
  }

  const admin = createServiceClient();
  const { error } = await admin.from("podcast_episodes").upsert(
    {
      youtube_video_id: videoId,
      title: title || "Untitled episode",
      show_notes: values.showNotes.trim(),
      thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      published_at: values.publishedAt
        ? new Date(`${values.publishedAt}T12:00:00Z`).toISOString()
        : null,
      source: "manual",
      hidden: false,
    },
    { onConflict: "youtube_video_id" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return { ok: true, message: "Episode added" };
}

/** Edit an episode in place (Matt, 2026-08-05: a YouTube-side correction
    doesn't flow back because the import never overwrites existing rows —
    curation is done here). Saving flips the episode to "manual", which
    marks it curated: the import's repair pass will never re-date or
    remove it, and the sync will never touch it. */
export async function updateEpisode(
  id: string,
  values: {
    title: string;
    showNotes: string;
    /** "YYYY-MM-DD" — blank keeps the current date. */
    publishedAt: string;
    /** Season number as typed; blank clears it. */
    season: string;
  },
): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const title = values.title.trim();
  if (!title) return { ok: false, message: "The title can't be empty" };
  const seasonRaw = values.season.trim();
  const season = seasonRaw === "" ? null : Number(seasonRaw);
  if (season !== null && (!Number.isInteger(season) || season < 1 || season > 999)) {
    return { ok: false, message: "Season should be a whole number (1, 2, 3…)" };
  }
  const patch: Record<string, unknown> = {
    title,
    show_notes: values.showNotes.trim(),
    season,
    source: "manual",
  };
  if (values.publishedAt.trim()) {
    const parsed = new Date(`${values.publishedAt.trim()}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, message: "That date doesn't look valid" };
    }
    patch.published_at = parsed.toISOString();
  }
  const admin = createServiceClient();
  const { error } = await admin
    .from("podcast_episodes")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return { ok: true, message: "Episode saved — it's now marked Manual, so syncs and imports will never overwrite it." };
}

/** Assign a season to every episode published inside a date range — the
    quick way to carve the back catalog into seasons. Applies to hidden
    episodes too; does NOT flip episodes to manual (season is organization,
    not content). */
export async function assignSeasonRange(values: {
  from: string; // "YYYY-MM-DD"
  to: string; // "YYYY-MM-DD"
  season: string;
}): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const season = Number(values.season.trim());
  if (!Number.isInteger(season) || season < 1 || season > 999) {
    return { ok: false, message: "Season should be a whole number (1, 2, 3…)" };
  }
  const from = new Date(`${values.from.trim()}T00:00:00Z`);
  const to = new Date(`${values.to.trim()}T23:59:59Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { ok: false, message: "Pick a valid from/to date range" };
  }
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("podcast_episodes")
    .update({ season })
    .gte("published_at", from.toISOString())
    .lte("published_at", to.toISOString())
    .select("id");
  if (error) {
    return {
      ok: false,
      message: /season/.test(error.message)
        ? "The database doesn't have the season column yet — run migration 0076 first."
        : error.message,
    };
  }
  const n = (data ?? []).length;
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return {
    ok: true,
    message: `Season ${season} assigned to ${n} episode${n === 1 ? "" : "s"} in that range.`,
  };
}

export async function setEpisodeHidden(
  id: string,
  hidden: boolean,
): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const admin = createServiceClient();
  const { error } = await admin
    .from("podcast_episodes")
    .update({ hidden })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return { ok: true };
}

export async function deleteEpisode(id: string): Promise<PodcastActionResult> {
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!isSupabaseConfigured()) return PREVIEW;
  const admin = createServiceClient();
  const { error } = await admin
    .from("podcast_episodes")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/branching-out");
  revalidatePath("/admin/podcast");
  return { ok: true };
}
