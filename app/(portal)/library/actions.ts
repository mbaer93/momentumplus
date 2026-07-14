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
