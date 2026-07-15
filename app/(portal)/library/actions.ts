"use server";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Record a library view (video_views feeds the member learning record).
 * RLS: members insert only their own rows. Fire-and-forget from the player.
 */
export async function recordVideoView(
  videoId: string,
  secondsWatched: number,
): Promise<void> {
  if (!isSupabaseConfigured()) return; // preview mode: nothing to record
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("video_views").insert({
    video_id: videoId,
    profile_id: user.id,
    seconds_watched: Math.max(0, Math.round(secondsWatched)),
  });
}

export interface NoteResult {
  ok: boolean;
  preview?: boolean;
  message?: string;
}

/**
 * Save the signed-in member's private note on a Library video. RLS is
 * owner-only — nobody else (admins included) can read these.
 */
export async function saveVideoNote(
  videoId: string,
  body: string,
): Promise<NoteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase.from("video_notes").upsert(
    {
      profile_id: user.id,
      video_id: videoId,
      body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,video_id" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
