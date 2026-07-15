import Link from "next/link";
import {
  CoursesManager,
  type AdminCourseRow,
  type VideoOption,
} from "@/components/admin/CoursesManager";
import { ArrowLeftIcon } from "@/components/icons";
import { listCourses, parseDocuments } from "@/lib/education";

/** Full quiz (with answers) for the admin editor. */
function adminQuiz(raw: unknown): { q: string; options: string[]; answer: number }[] {
  const questions = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .filter(
      (q): q is { q?: unknown; options?: unknown; answer?: unknown } =>
        typeof q === "object" && q !== null,
    )
    .map((q) => ({
      q: typeof q.q === "string" ? q.q : "",
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === "string")
        : [],
      answer: typeof q.answer === "number" ? q.answer : 0,
    }));
}
import { placeholderVideos } from "@/lib/videos/data";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminEducationPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: AdminCourseRow[];
  let videos: VideoOption[];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const [{ data: courses }, { data: vids }] = await Promise.all([
      admin
        .from("courses")
        .select(
          "id, title, description, category, min_access, published_at, ce_hours, course_lessons ( id, title, summary, video_id, position, content, image_url, documents, quiz )",
        )
        .order("position"),
      admin.from("videos").select("id, title").order("title"),
    ]);
    rows = (courses ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category ?? "",
      description: c.description ?? "",
      minAccess:
        c.min_access === "vip_plus" || c.min_access === "pro_only"
          ? c.min_access
          : "all_members",
      published: Boolean(c.published_at),
      ceHours: c.ce_hours === null ? null : Number(c.ce_hours),
      lessons: [...(c.course_lessons ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          id: l.id,
          title: l.title,
          summary: l.summary ?? "",
          videoId: l.video_id,
          content: l.content ?? "",
          imageUrl: l.image_url ?? null,
          documents: parseDocuments(l.documents),
          quiz: adminQuiz(l.quiz),
        })),
    }));
    videos = vids ?? [];
  } else {
    const courses = await listCourses();
    rows = courses.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      description: c.description,
      minAccess: c.minAccess,
      published: c.published,
      ceHours: c.ceHours,
      lessons: c.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary,
        videoId: l.videoId,
        content: l.content,
        imageUrl: l.imageUrl,
        documents: l.documents,
        quiz: [],
      })),
    }));
    videos = placeholderVideos.map((v) => ({ id: v.id, title: v.title }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Education</h2>
          <p>Courses and learning tracks built from library recordings</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample courses. Changes persist once Supabase is
          connected.
        </div>
      )}
      <CoursesManager
        courses={rows}
        videos={videos}
        initialEditId={searchParams?.edit}
      />
    </div>
  );
}
