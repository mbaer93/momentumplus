"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ProgressResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
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
