import Link from "next/link";
import { SpeakersManager } from "@/components/admin/SpeakersManager";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { speakers as placeholderSpeakers } from "@/lib/directory-data";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminSpeakersPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: EntityRow[] = placeholderSpeakers.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: s.title,
    values: {
      name: s.name,
      title: s.title,
      industries: s.industries.join(", "),
      website: s.website ?? "",
      bio: s.bio,
      featured: false,
      headshotUrl: s.headshotUrl ?? "",
    },
  }));

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("speakers")
      .select("id, name, title, bio, industries, website, headshot_url, featured")
      .order("featured", { ascending: false })
      .order("name");
    rows = (data ?? []).map((s) => ({
      id: s.id,
      title: s.name,
      subtitle: s.title ?? "",
      badge: s.featured ? "Featured" : undefined,
      values: {
        name: s.name,
        title: s.title ?? "",
        industries: (s.industries ?? []).join(", "),
        website: s.website ?? "",
        bio: s.bio ?? "",
        featured: Boolean(s.featured),
        headshotUrl: s.headshot_url ?? "",
      },
    }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Speakers</h2>
          <p>Profiles shown in the member speaker directory</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample speakers. Changes persist once Supabase is
          connected.
        </div>
      )}
      <SpeakersManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
