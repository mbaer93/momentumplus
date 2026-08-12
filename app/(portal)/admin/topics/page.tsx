import { redirect } from "next/navigation";
import {
  TopicsManager,
  type TaggableItem,
} from "@/components/admin/TopicsManager";
import { requireAdmin } from "@/lib/auth-helpers";
import { SPEAKER_FROM_SESSION } from "@/lib/session-speaker-embed";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listTopics } from "@/lib/topics";

export const dynamic = "force-dynamic";

export const metadata = { title: "Library Categories | Momentum+" };

interface TopicLink {
  topic_id: string;
  is_primary: boolean;
}

function split(links: TopicLink[] | null | undefined) {
  const rows = links ?? [];
  return {
    primaryId: rows.find((l) => l.is_primary)?.topic_id ?? null,
    secondaryIds: rows.filter((l) => !l.is_primary).map((l) => l.topic_id),
  };
}

/*
 * Library categories — Sierra's browse-by-subject taxonomy, and what each
 * recording and session is filed under. Separate from a session's format
 * (Monthly Educational Session, Productivity Session), which lives on the
 * session form.
 */
export default async function AdminTopicsPage() {
  if (isSupabaseConfigured()) {
    const auth = await requireAdmin("content");
    if (!auth.ok) redirect("/admin");
  }

  const topics = await listTopics();

  let items: TaggableItem[] = [];
  let needsMigration = false;
  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createServiceClient();
    const [videos, sessions] = await Promise.all([
      db
        .from("videos")
        .select(
          `id, title, session_id, video_topics ( topic_id, is_primary ), sessions ( ${SPEAKER_FROM_SESSION} ( name ) )`,
        )
        .is("archived_at", null)
        .order("published_at", { ascending: false })
        .limit(300),
      db
        .from("sessions")
        .select(
          `id, title, host_name, session_topics ( topic_id, is_primary ), ${SPEAKER_FROM_SESSION} ( name )`,
        )
        .order("starts_at", { ascending: false })
        .limit(300),
    ]);

    needsMigration = Boolean(
      videos.error &&
        /video_topics|content_topics|session_topics/.test(videos.error.message),
    );

    if (!needsMigration) {
      const videoItems: TaggableItem[] = (
        (videos.data ?? []) as unknown as {
          id: string;
          title: string;
          video_topics: TopicLink[] | null;
          sessions: { speakers: { name: string } | null } | null;
        }[]
      ).map((v) => ({
        id: v.id,
        title: v.title,
        speakerName: v.sessions?.speakers?.name ?? "",
        kind: "video" as const,
        ...split(v.video_topics),
      }));

      // Only sessions with no recording yet — once a recording exists it is
      // the thing members browse, and two editors for one talk is a trap.
      const recorded = new Set(
        ((videos.data ?? []) as unknown as { session_id?: string }[])
          .map((v) => v.session_id)
          .filter(Boolean),
      );
      const sessionItems: TaggableItem[] = (
        (sessions.data ?? []) as unknown as {
          id: string;
          title: string;
          host_name: string | null;
          session_topics: TopicLink[] | null;
          speakers: { name: string } | null;
        }[]
      )
        .filter((s) => !recorded.has(s.id))
        .map((s) => ({
          id: s.id,
          title: s.title,
          speakerName: s.speakers?.name ?? s.host_name ?? "",
          kind: "session" as const,
          ...split(s.session_topics),
        }));

      items = [...videoItems, ...sessionItems];
    }
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Library Categories</h2>
          <p>
            The subjects members browse the Library by, and what each talk is
            filed under.
          </p>
        </div>
      </div>
      {needsMigration ? (
        <div className="admin-hint">
          Run <code>0055_content_topics_and_season.sql</code> in Supabase to
          turn on categories.
        </div>
      ) : (
        <TopicsManager topics={topics} items={items} />
      )}
    </div>
  );
}
