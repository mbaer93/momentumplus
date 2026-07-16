"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ProgressResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

/** Progress writes require a live membership, not just a login. */
async function membershipActive(): Promise<boolean> {
  const member = await getCurrentMember();
  return Boolean(member?.membershipActive);
}

/** Mark a lesson complete/incomplete for the signed-in member (RLS: own rows). */
export async function setLessonComplete(
  lessonId: string,
  completed: boolean,
): Promise<ProgressResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(await membershipActive())) {
    return { ok: false, message: "Your membership has lapsed — renew to continue learning." };
  }

  // Quiz lessons only complete through submitLessonQuiz (server-graded) —
  // this manual toggle must never mint certificate progress for them.
  if (completed) {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const { data: lesson } = await createServiceClient()
      .from("course_lessons")
      .select("quiz")
      .eq("id", lessonId)
      .maybeSingle();
    if (!lesson) return { ok: false, message: "Lesson not found." };
    if (lesson.quiz) {
      return { ok: false, message: "This lesson has a test — pass it to complete." };
    }
  }

  const { error } = completed
    ? await supabase
        .from("lesson_progress")
        .upsert(
          { profile_id: user.id, lesson_id: lessonId },
          { onConflict: "profile_id,lesson_id" },
        )
    : await supabase
        .from("lesson_progress")
        .delete()
        .eq("profile_id", user.id)
        .eq("lesson_id", lessonId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/education");
  return { ok: true };
}

/**
 * Auto-completion for lessons without a test: opening the lesson (reading
 * the information / starting the video) marks it complete. No-ops for quiz
 * lessons — those complete only by passing the test.
 */
export async function markLessonOpened(lessonId: string): Promise<ProgressResult> {
  if (!isSupabaseConfigured()) return { ok: true, preview: true };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(await membershipActive())) return { ok: true };

  // Quiz presence is checked server-side so the client can't skip a test.
  const { data: lesson } = await createServiceClient()
    .from("course_lessons")
    .select("quiz")
    .eq("id", lessonId)
    .maybeSingle();
  const hasQuiz = Boolean(
    (lesson?.quiz as { questions?: unknown[] } | null)?.questions?.length,
  );
  if (hasQuiz) return { ok: true };

  const { error } = await supabase.from("lesson_progress").upsert(
    { profile_id: user.id, lesson_id: lessonId },
    { onConflict: "profile_id,lesson_id" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/education");
  return { ok: true };
}

export interface QuizResult {
  ok: boolean;
  passed: boolean;
  scorePct: number;
  message?: string;
  preview?: boolean;
}

interface StoredQuiz {
  questions?: { q?: string; options?: string[]; answer?: number }[];
  passPct?: number;
}

/**
 * Grade a lesson test server-side (answers are option indexes, in question
 * order). Passing marks the lesson complete; default pass mark is 70%.
 */
export async function submitLessonQuiz(
  lessonId: string,
  answers: number[],
): Promise<QuizResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, passed: true, scorePct: 100, preview: true };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, passed: false, scorePct: 0, message: "Not signed in." };
  if (!(await membershipActive())) {
    return {
      ok: false,
      passed: false,
      scorePct: 0,
      message: "Your membership has lapsed — renew to take tests.",
    };
  }

  const { data: lesson } = await createServiceClient()
    .from("course_lessons")
    .select("quiz")
    .eq("id", lessonId)
    .maybeSingle();
  const quiz = (lesson?.quiz ?? null) as StoredQuiz | null;
  const questions = quiz?.questions ?? [];
  if (questions.length === 0) {
    return { ok: false, passed: false, scorePct: 0, message: "This lesson has no test." };
  }

  const correct = questions.reduce(
    (n, q, i) =>
      n + (typeof q.answer === "number" && answers[i] === q.answer ? 1 : 0),
    0,
  );
  const scorePct = Math.round((correct / questions.length) * 100);
  const passPct = quiz?.passPct ?? 70;
  const passed = scorePct >= passPct;

  if (passed) {
    // Service role on purpose: RLS blocks members from inserting progress
    // for quiz lessons (migration 0020) — passing the server-graded test is
    // the only way to complete one, and this is that path.
    const { error } = await createServiceClient().from("lesson_progress").upsert(
      { profile_id: user.id, lesson_id: lessonId },
      { onConflict: "profile_id,lesson_id" },
    );
    if (error) return { ok: false, passed, scorePct, message: error.message };
    revalidatePath("/education");
  }

  return {
    ok: true,
    passed,
    scorePct,
    message: passed
      ? `Passed — ${scorePct}%. Lesson complete.`
      : `${scorePct}% — you need ${passPct}% to pass. Review the material and try again.`,
  };
}
