"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ActionResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null };
  return { supabase, user };
}

/**
 * Enroll the current member in a session. Enrollment writes are additionally
 * guarded by RLS (the enrollments insert policy checks the session is
 * visible + scheduled/live), so this is defense-in-depth, not the only gate.
 */
export async function enrollInSession(sessionId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Enrolled (preview)" };
  }
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "You must be signed in to enroll." };

  const { error } = await supabase
    .from("enrollments")
    .upsert(
      { session_id: sessionId, profile_id: user.id },
      { onConflict: "session_id,profile_id", ignoreDuplicates: true },
    );

  if (error) {
    // The capacity trigger raises "Session is full" — say it like a human.
    if (error.message.includes("Session is full")) {
      return {
        ok: false,
        message: "This session is at capacity — no seats left.",
      };
    }
    // RLS blocks enrolling in cancelled/completed/archived sessions — the
    // raw policy violation reads like a database stack trace to a member.
    if (/row-level security/i.test(error.message)) {
      return {
        ok: false,
        message:
          "Enrollment isn't open for this session — it may have been cancelled or already ended.",
      };
    }
    return {
      ok: false,
      message: "Couldn't enroll you just now — refresh and try again.",
    };
  }

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  return { ok: true, message: "You're enrolled." };
}

export async function unenrollFromSession(
  sessionId: string,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Unenrolled (preview)" };
  }
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "You must be signed in." };

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("session_id", sessionId)
    .eq("profile_id", user.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  return { ok: true, message: "You're no longer enrolled." };
}

/**
 * Save the member's private note for a session. RLS restricts session_notes to
 * the owner (SPEC.md §3), so a member can only ever write their own note.
 */
export async function saveSessionNote(
  sessionId: string,
  body: string,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview)" };
  }
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "You must be signed in." };

  const { error } = await supabase.from("session_notes").upsert(
    {
      session_id: sessionId,
      profile_id: user.id,
      body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,profile_id" },
  );

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Saved" };
}
