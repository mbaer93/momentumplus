import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { canAccess } from "@/lib/access";
import type { Tier } from "@/lib/types";

/*
 * Education: curated courses (learning tracks) built from library videos,
 * with per-member lesson completion. Supabase when configured (RLS hides
 * unpublished/gated courses); placeholder tracks in preview mode.
 */

export interface LessonDocument {
  name: string;
  url: string;
}

/** Quiz question as shown to members — correct answers never leave the server. */
export interface QuizQuestionPublic {
  q: string;
  options: string[];
}

export interface CourseLesson {
  id: string;
  title: string;
  summary: string;
  videoId: string | null;
  /** Reading/information body (plain text, paragraphs split on blank lines). */
  content: string;
  imageUrl: string | null;
  documents: LessonDocument[];
  /** Present when the lesson has a test; completion requires passing it. */
  quiz: QuizQuestionPublic[] | null;
  completed: boolean;
}

export interface CourseItem {
  id: string;
  title: string;
  description: string;
  category: string;
  minAccess: "all_members" | "vip_plus" | "pro_only";
  published: boolean;
  /** Educational hours printed on the certificate of completion. */
  ceHours: number | null;
  lessons: CourseLesson[];
  completedCount: number;
  /** For locked teaser courses (RLS hides their lessons), the real lesson
      count fetched via the service role; defaults to lessons.length. */
  lessonCount?: number;
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
    ceHours: 2,
    completedCount: 1,
    lessons: [
      {
        id: "rl-1",
        title: "The Burnout Blueprint",
        summary: "Spot the early physiological signals before they cost you a quarter.",
        videoId: "burnout-blueprint",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
        completed: true,
      },
      {
        id: "rl-2",
        title: "The Vitality Blueprint",
        summary: "Design your energy like a system: sleep, fuel, and recovery blocks.",
        videoId: "vitality-blueprint",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
        completed: false,
      },
      {
        id: "rl-3",
        title: "The Trust Architecture",
        summary: "The team foundations that keep performance from depending on heroics.",
        videoId: "trust-architecture",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
        completed: false,
      },
      {
        id: "rl-4",
        title: "Culture by Design",
        summary: "Turn personal resilience into a team operating rhythm.",
        videoId: "culture-by-design",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
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
    ceHours: 1.5,
    completedCount: 0,
    lessons: [
      {
        id: "rm-1",
        title: "The Revenue Architecture",
        summary: "Design a business that scales beyond its founder.",
        videoId: "revenue-architecture",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
        completed: false,
      },
      {
        id: "rm-2",
        title: "Pricing for Premium",
        summary: "Charge what you're worth — positioning, anchors, and offers.",
        videoId: "pricing-premium",
        content: "",
        imageUrl: null,
        documents: [],
        quiz: null,
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
  ce_hours: number | null;
  course_lessons:
    | {
        id: string;
        title: string;
        summary: string | null;
        video_id: string | null;
        position: number;
        content: string | null;
        image_url: string | null;
        documents: unknown;
        quiz: unknown;
      }[]
    | null;
}

export function parseDocuments(raw: unknown): LessonDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is { name?: unknown; url?: unknown } =>
        typeof d === "object" && d !== null,
    )
    .map((d) => ({
      name: typeof d.name === "string" ? d.name : "Document",
      url: typeof d.url === "string" ? d.url : "",
    }))
    .filter((d) => d.url);
}

/** Strip correct answers before quiz questions go to the browser. */
export function publicQuiz(raw: unknown): QuizQuestionPublic[] | null {
  const questions = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const cleaned = questions
    .filter(
      (q): q is { q?: unknown; options?: unknown } =>
        typeof q === "object" && q !== null,
    )
    .map((q) => ({
      q: typeof q.q === "string" ? q.q : "",
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === "string")
        : [],
    }))
    .filter((q) => q.q && q.options.length >= 2);
  return cleaned.length > 0 ? cleaned : null;
}

export interface GradableQuestion {
  options: string[];
  answer: number | null;
}

/**
 * Same cleaning as publicQuiz but keeping the correct answer, with the
 * answer index remapped onto the cleaned options. Grading MUST judge the
 * exact question/option list the member saw — grading the raw stored array
 * would misalign every answer the moment the display filter drops anything.
 */
export function gradableQuiz(raw: unknown): GradableQuestion[] {
  const questions = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  const out: GradableQuestion[] = [];
  for (const q of questions) {
    if (typeof q !== "object" || q === null) continue;
    const rec = q as { q?: unknown; options?: unknown; answer?: unknown };
    if (typeof rec.q !== "string" || !rec.q) continue;
    const rawOptions = Array.isArray(rec.options) ? rec.options : [];
    const options: string[] = [];
    let answer: number | null = null;
    rawOptions.forEach((o, i) => {
      if (typeof o !== "string") return;
      if (typeof rec.answer === "number" && rec.answer === i) {
        answer = options.length;
      }
      options.push(o);
    });
    if (options.length < 2) continue;
    out.push({ options, answer });
  }
  return out;
}

export async function listCourses(): Promise<CourseItem[]> {
  if (!isSupabaseConfigured()) return PLACEHOLDER_COURSES;
  // (teasers for RLS-hidden gated courses are appended at the end)

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The quiz column is not member-selectable (migration 0020 hides the
  // answers at the DB boundary), and progress is filtered to the viewer —
  // the read-own-or-admin policy would otherwise count OTHER members'
  // completions for admins, minting certificates in the admin's name.
  const [{ data, error }, { data: progress }] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, title, description, category, min_access, published_at, ce_hours, course_lessons ( id, title, summary, video_id, position, content, image_url, documents )",
      )
      .order("position"),
    user
      ? supabase
          .from("lesson_progress")
          .select("lesson_id")
          .eq("profile_id", user.id)
      : Promise.resolve({ data: [] as { lesson_id: string }[] }),
  ]);
  if (error || !data) {
    return error ? [] : await lockedCourseTeasers(new Set());
  }

  // Server-side enrichment: quiz questions (answers stripped before they
  // reach the browser) and signed URLs for the private media bucket.
  const rows = data as unknown as CourseRow[];
  const lessonIds = rows.flatMap((r) => (r.course_lessons ?? []).map((l) => l.id));
  const quizById = new Map<string, unknown>();
  let signedUrls = new Map<string, string>();
  if (lessonIds.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const { signEducationUrls } = await import("@/lib/education-media");
    const [{ data: quizRows }, signed] = await Promise.all([
      createServiceClient()
        .from("course_lessons")
        .select("id, quiz")
        .in("id", lessonIds),
      signEducationUrls(
        rows.flatMap((r) =>
          (r.course_lessons ?? []).flatMap((l) => [
            l.image_url,
            ...parseDocuments(l.documents).map((d) => d.url),
          ]),
        ),
      ),
    ]);
    for (const q of quizRows ?? []) quizById.set(q.id as string, q.quiz);
    signedUrls = signed;
  }
  const usable = (url: string | null) =>
    url ? (signedUrls.get(url) ?? url) : null;

  const done = new Set((progress ?? []).map((p) => p.lesson_id as string));
  const mapped = rows.map((row) => {
    const lessons = [...(row.course_lessons ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary ?? "",
        videoId: l.video_id,
        content: l.content ?? "",
        imageUrl: usable(l.image_url ?? null),
        documents: parseDocuments(l.documents).map((d) => ({
          ...d,
          url: usable(d.url) ?? d.url,
        })),
        quiz: publicQuiz(quizById.get(l.id) ?? null),
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
      ceHours: row.ce_hours === null ? null : Number(row.ce_hours),
      lessons,
      completedCount: lessons.filter((l) => l.completed).length,
    } satisfies CourseItem;
  });
  const teasers = await lockedCourseTeasers(new Set(mapped.map((c) => c.id)));
  return [...mapped, ...teasers];
}

/*
 * Gated (VIP/Pro) courses are invisible to under-tier members at the RLS
 * layer — which would hide the upgrade path entirely. Fetch published
 * courses' metadata (never lesson content or quizzes) through the service
 * role and append locked teasers for any the member can't see.
 */
async function lockedCourseTeasers(
  visibleIds: Set<string>,
): Promise<CourseItem[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const { createServiceClient } = await import("@/lib/supabase/admin");
    const { data } = await createServiceClient()
      .from("courses")
      .select(
        "id, title, description, category, min_access, ce_hours, published_at, course_lessons ( id )",
      )
      .not("published_at", "is", null)
      .order("position");
    return (data ?? [])
      .filter((row) => !visibleIds.has(row.id as string))
      .map((row) => ({
        id: row.id as string,
        title: row.title as string,
        description: (row.description as string) ?? "",
        category: (row.category as string) ?? "Leadership",
        minAccess:
          row.min_access === "vip_plus" || row.min_access === "pro_only"
            ? (row.min_access as "vip_plus" | "pro_only")
            : "all_members",
        published: true,
        ceHours: row.ce_hours === null ? null : Number(row.ce_hours),
        lessons: [],
        completedCount: 0,
        lessonCount: ((row.course_lessons as { id: string }[]) ?? []).length,
      }));
  } catch {
    return [];
  }
}

export async function getCourse(id: string): Promise<CourseItem | null> {
  const all = await listCourses();
  return all.find((c) => c.id === id) ?? null;
}
