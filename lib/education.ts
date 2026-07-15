import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import type { Tier } from "@/lib/types";

/*
 * Education: curated courses (learning tracks) built from library videos,
 * with per-member lesson completion. Supabase when configured (RLS hides
 * unpublished/gated courses); placeholder tracks in preview mode.
 */

export interface CourseLesson {
  id: string;
  title: string;
  summary: string;
  videoId: string | null;
  completed: boolean;
}

export interface CourseItem {
  id: string;
  title: string;
  description: string;
  category: string;
  minAccess: "all_members" | "vip_plus" | "pro_only";
  published: boolean;
  lessons: CourseLesson[];
  completedCount: number;
}

export function courseUnlocked(course: CourseItem, tier: Tier): boolean {
  return canAccess(tier, course.minAccess);
}

const PLACEHOLDER_COURSES: CourseItem[] = [
  {
    id: "resilient-leader",
    title: "The Resilient Leader Track",
    description:
      "A four-part track pairing Holly's resilience frameworks with Rob's team systems — build personal stamina, then scale it to your team.",
    category: "Leadership",
    minAccess: "all_members",
    published: true,
    completedCount: 1,
    lessons: [
      {
        id: "rl-1",
        title: "The Burnout Blueprint",
        summary: "Spot the early physiological signals before they cost you a quarter.",
        videoId: "burnout-blueprint",
        completed: true,
      },
      {
        id: "rl-2",
        title: "The Vitality Blueprint",
        summary: "Design your energy like a system: sleep, fuel, and recovery blocks.",
        videoId: "vitality-blueprint",
        completed: false,
      },
      {
        id: "rl-3",
        title: "The Trust Architecture",
        summary: "The team foundations that keep performance from depending on heroics.",
        videoId: "trust-architecture",
        completed: false,
      },
      {
        id: "rl-4",
        title: "Culture by Design",
        summary: "Turn personal resilience into a team operating rhythm.",
        videoId: "culture-by-design",
        completed: false,
      },
    ],
  },
  {
    id: "revenue-mastery",
    title: "Revenue Mastery",
    description:
      "Katie Nelson's business-growth sequence: architect the model, then price it like a premium brand.",
    category: "Business",
    minAccess: "vip_plus",
    published: true,
    completedCount: 0,
    lessons: [
      {
        id: "rm-1",
        title: "The Revenue Architecture",
        summary: "Design a business that scales beyond its founder.",
        videoId: "revenue-architecture",
        completed: false,
      },
      {
        id: "rm-2",
        title: "Pricing for Premium",
        summary: "Charge what you're worth — positioning, anchors, and offers.",
        videoId: "pricing-premium",
        completed: false,
      },
    ],
  },
];

interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  min_access: "all_members" | "vip_plus" | "pro_only" | "admin_only";
  published_at: string | null;
  course_lessons:
    | {
        id: string;
        title: string;
        summary: string | null;
        video_id: string | null;
        position: number;
      }[]
    | null;
}

export async function listCourses(): Promise<CourseItem[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_COURSES;

  const supabase = createClient();
  const [{ data, error }, { data: progress }] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, title, description, category, min_access, published_at, course_lessons ( id, title, summary, video_id, position )",
      )
      .order("position"),
    supabase.from("lesson_progress").select("lesson_id"),
  ]);
  if (error || !data) return [];

  const done = new Set((progress ?? []).map((p) => p.lesson_id as string));
  return (data as unknown as CourseRow[]).map((row) => {
    const lessons = [...(row.course_lessons ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary ?? "",
        videoId: l.video_id,
        completed: done.has(l.id),
      }));
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      category: row.category ?? "Leadership",
      minAccess:
        row.min_access === "vip_plus" || row.min_access === "pro_only"
          ? row.min_access
          : "all_members",
      published: Boolean(row.published_at),
      lessons,
      completedCount: lessons.filter((l) => l.completed).length,
    } satisfies CourseItem;
  });
}

export async function getCourse(id: string): Promise<CourseItem | null> {
  const all = await listCourses();
  return all.find((c) => c.id === id) ?? null;
}
