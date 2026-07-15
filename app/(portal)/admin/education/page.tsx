import Link from "next/link";
import {
  CoursesManager,
  type AdminCourseRow,
  type VideoOption,
} from "@/components/admin/CoursesManager";
import { ArrowLeftIcon } from "@/components/icons";
import { listCourses } from "@/lib/education";
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
          "id, title, description, category, min_access, published_at, course_lessons ( id, title, summary, video_id, position )",
        )
        .order("position"),
      admin.from("videos").select("id, title").order("title"),
    ]);
    rows = (courses ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category ?? "",
      description: c.description ?? "",
      minAccess: c.min_access === "vip_plus" ? "vip_plus" : "all_members",
      published: Boolean(c.published_at),
      lessons: [...(c.course_lessons ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          id: l.id,
          title: l.title,
          summary: l.summary ?? "",
          videoId: l.video_id,
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
      lessons: c.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary,
        videoId: l.videoId,
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
