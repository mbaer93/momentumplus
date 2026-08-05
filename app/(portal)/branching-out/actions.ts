"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface EpisodeActionResult {
  ok: boolean;
  preview?: boolean;
  message?: string;
}

/** Writes require a live membership, not just a login — same rule as the
    Library actions. */
async function membershipActive(): Promise<boolean> {
  const member = await getCurrentMember();
  return Boolean(member?.membershipActive);
}

/**
 * Record that the member finished an episode (the player's ended event, or
 * the manual "Mark as listened" toggle — episodes are also heard on
 * Spotify or in the car). Powers the green check on the episode card.
 */
export async function setEpisodeCompleted(
  episodeId: string,
  completed: boolean,
): Promise<EpisodeActionResult> {
  if (!isSupabaseConfigured()) return { ok: true, preview: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(await membershipActive())) {
    return { ok: false, message: "Your membership has lapsed." };
  }

  const { error } = await supabase.from("podcast_episode_progress").upsert(
    {
      profile_id: user.id,
      episode_id: episodeId,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,episode_id" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/branching-out");
  return { ok: true };
}

/** Save the member's private note on an episode. RLS is owner-only —
    nobody else (admins included) can read these. */
export async function saveEpisodeNote(
  episodeId: string,
  body: string,
): Promise<EpisodeActionResult> {
  if (!isSupabaseConfigured()) return { ok: true, preview: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(await membershipActive())) {
    return {
      ok: false,
      message: "Your membership has lapsed — renew to keep taking notes.",
    };
  }

  // The upsert must not clobber completion — only set the note fields.
  const { data: existing } = await supabase
    .from("podcast_episode_progress")
    .select("completed, completed_at")
    .eq("profile_id", user.id)
    .eq("episode_id", episodeId)
    .maybeSingle();
  const { error } = await supabase.from("podcast_episode_progress").upsert(
    {
      profile_id: user.id,
      episode_id: episodeId,
      completed: existing?.completed ?? false,
      completed_at: existing?.completed_at ?? null,
      notes: body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,episode_id" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export const QUESTION_KINDS = ["question", "challenge", "unscripted"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** Submit a question, challenge, or "Leadership Unscripted" prompt for the
    show to ask a guest on the air. */
export async function submitPodcastQuestion(
  kind: string,
  body: string,
): Promise<EpisodeActionResult> {
  if (!isSupabaseConfigured()) return { ok: true, preview: true };
  if (!(QUESTION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: "Pick what you're sending in." };
  }
  const text = body.trim();
  if (!text) return { ok: false, message: "Write your question first." };
  if (text.length > 2000) {
    return { ok: false, message: "Keep it under 2,000 characters." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(await membershipActive())) {
    return { ok: false, message: "Your membership has lapsed." };
  }

  const { error } = await supabase.from("podcast_questions").insert({
    profile_id: user.id,
    kind,
    body: text,
  });
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    message: "Sent — thanks! We may bring it up with a guest on the air.",
  };
}
