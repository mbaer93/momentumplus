"use server";

import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Writes require a live membership, not just a login — the UI already
 *  locks lapsed members out, and the server actions must agree with it. */
async function membershipActive(): Promise<boolean> {
  const member = await getCurrentMember();
  return Boolean(member?.membershipActive);
}

/**
 * Record a library view (video_views feeds the member learning record).
 * RLS: members insert only their own rows. Fire-and-forget from the player.
 * One row per member+video (unique index) — repeat visits update it instead
 * of inflating the learning record.
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
  if (!user || !(await membershipActive())) return;

  await supabase.from("video_views").upsert(
    {
      video_id: videoId,
      profile_id: user.id,
      seconds_watched: Math.max(0, Math.round(secondsWatched)),
    },
    { onConflict: "profile_id,video_id" },
  );
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
  if (!(await membershipActive())) {
    return { ok: false, message: "Your membership has lapsed — renew to keep taking notes." };
  }

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
