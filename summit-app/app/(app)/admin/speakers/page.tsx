import Link from "next/link";
import { EventSpeakersManager } from "@/components/summit/EventSpeakersManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminSpeakersPage() {
  let rows: EntityRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("event_speakers")
      .select("id, name, title, bio, headshot_url, website, tags, sort_order, active")
      .order("sort_order")
      .order("name");
    rows = (data ?? []).map((s) => ({
      id: s.id as string,
      title: s.name as string,
      subtitle: (s.title as string) ?? "",
      badge: s.active ? undefined : "Hidden",
      values: {
        name: s.name as string,
        title: (s.title as string) ?? "",
        bio: (s.bio as string) ?? "",
        headshotUrl: (s.headshot_url as string) ?? "",
        website: (s.website as string) ?? "",
        tags: (s.tags as string) ?? "",
        sortOrder: String(s.sort_order ?? 0),
        active: Boolean(s.active),
      },
    }));
  }

  return (
    <div className="tsls-pad">
      <Link href="/admin" className="tsls-back">
        ← Summit Admin
      </Link>
      <div className="tsls-page-header">
        <h2>Event Speakers</h2>
        <p>The summit lineup — link them to agenda slots on the Agenda page</p>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: changes persist once Supabase is connected.
        </div>
      )}
      <EventSpeakersManager rows={rows} />
    </div>
  );
}
