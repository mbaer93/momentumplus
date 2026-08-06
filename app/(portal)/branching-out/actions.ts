"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Journal completion-save failures into the Platform Errors console
    (Matt, 2026-08-05: the green check wasn't persisting and every failure
    was invisible — this makes the real reason show up in Admin → Errors).
    Never throws; diagnostics must not break the action. */
async function logProgressIssue(step: string, detail: string): Promise<void> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const admin = createServiceClient();
    const message = `podcast-progress ${step}: ${detail}`.slice(0, 500);
    const hash = createHash("sha256").update(message).digest("hex").slice(0, 32);
    const nowIso = new Date().toISOString();
    const { data: existing } = await admin
      .from("error_reports")
      .select("hash, count")
      .eq("hash", hash)
      .maybeSingle();
    if (existing) {
      await admin
        .from("error_reports")
        .update({ count: Number(existing.count ?? 0) + 1, last_seen: nowIso })
        .eq("hash", hash);
    } else {
      await admin.from("error_reports").insert({
        hash,
        message,
        path: "/branching-out",
        count: 1,
        first_seen: nowIso,
        last_seen: nowIso,
      });
    }
  } catch {
    /* swallow — see docstring */
  }
}

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
  try {
    if (!isSupabaseConfigured()) {
      await logProgressIssue("preview-exit", "isSupabaseConfigured() false in production");
      return { ok: true, preview: true };
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      await logProgressIssue("no-user", "auth.getUser() returned null");
      return { ok: false, message: "Not signed in." };
    }
    if (!(await membershipActive())) {
      await logProgressIssue("membership", `no active membership for ${user.id}`);
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
    if (error) {
      await logProgressIssue("upsert", `${error.code ?? ""} ${error.message}`);
      return { ok: false, message: error.message };
    }
    revalidatePath("/branching-out");
    return { ok: true };
  } catch (e) {
    await logProgressIssue("thrown", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return { ok: false, message: "Couldn't save — the team has been notified." };
  }
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

// NOT exported: a "use server" module may only export async functions —
// exporting this const made the whole module fail to load at action
// invocation time, which is why no action in this file ever ran.
const QUESTION_KINDS = ["question", "challenge", "unscripted"] as const;

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
  // Durable cap (audit P2-21): the submissions table is otherwise an
  // unbounded write path for any signed-in member.
  const { allowAction } = await import("@/lib/throttle");
  if (!(await allowAction(user.id, "podcast_question", 10, 60 * 60 * 1000))) {
    return {
      ok: false,
      message: "That's a lot of questions at once — try again in an hour.",
    };
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
