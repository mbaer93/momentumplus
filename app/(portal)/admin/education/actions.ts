"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface CourseInput {
  title: string;
  category: string;
  description: string;
  minAccess: "all_members" | "vip_plus";
  published: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

async function guard(): Promise<AdminResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  return null;
}

function refresh() {
  revalidatePath("/admin/education");
  revalidatePath("/education");
}

function toRow(input: CourseInput) {
  return {
    title: input.title.trim(),
    category: input.category.trim() || null,
    description: input.description.trim() || null,
    min_access: input.minAccess,
  };
}

export async function createCourse(input: CourseInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("courses")
    .insert({
      ...toRow(input),
      published_at: input.published ? new Date().toISOString() : null,
    });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Course created." };
}

export async function updateCourse(
  id: string,
  input: CourseInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const admin = createServiceClient();
  const { data: existing } = await admin
    .from("courses")
    .select("published_at")
    .eq("id", id)
    .maybeSingle();
  const published_at = input.published
    ? (existing?.published_at ?? new Date().toISOString())
    : null;

  const { error } = await admin
    .from("courses")
    .update({ ...toRow(input), published_at })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Course saved." };
}

export async function deleteCourse(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("courses")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Course deleted." };
}

export async function addLesson(
  courseId: string,
  input: { videoId: string; title: string; summary: string },
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  if (!input.title.trim()) {
    return { ok: false, message: "Give the lesson a title." };
  }

  const admin = createServiceClient();
  const { data: last } = await admin
    .from("course_lessons")
    .select("position")
    .eq("course_id", courseId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("course_lessons").insert({
    course_id: courseId,
    video_id: input.videoId || null,
    title: input.title.trim(),
    summary: input.summary.trim() || null,
    position: (last?.position ?? 0) + 1,
  });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Lesson added." };
}

export async function removeLesson(lessonId: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("course_lessons")
    .delete()
    .eq("id", lessonId);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Lesson removed." };
}

/** Swap a lesson's position with its neighbor above/below. */
export async function moveLesson(
  lessonId: string,
  direction: "up" | "down",
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const admin = createServiceClient();
  const { data: lesson } = await admin
    .from("course_lessons")
    .select("id, course_id, position")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return { ok: false, message: "Lesson not found." };

  const { data: neighbor } = await admin
    .from("course_lessons")
    .select("id, position")
    .eq("course_id", lesson.course_id)
    .order("position", { ascending: direction === "down" })
    .filter(
      "position",
      direction === "up" ? "lt" : "gt",
      lesson.position,
    )
    .limit(1)
    .maybeSingle();
  if (!neighbor) return { ok: true }; // already at the edge

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    admin
      .from("course_lessons")
      .update({ position: neighbor.position })
      .eq("id", lesson.id),
    admin
      .from("course_lessons")
      .update({ position: lesson.position })
      .eq("id", neighbor.id),
  ]);
  if (e1 || e2) return { ok: false, message: (e1 ?? e2)?.message };
  refresh();
  return { ok: true };
}
