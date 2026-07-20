import Link from "next/link";
import { SpeakersManager } from "@/components/admin/SpeakersManager";
import {
  SpeakerLifecyclePanel,
  type PastSpeakerRow,
  type PendingSpeakerInvite,
} from "@/components/admin/SpeakerLifecyclePanel";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { speakers as placeholderSpeakers } from "@/lib/directory-data";
import { sponsorActive } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

interface AdminSpeakerRow {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  industries: string[] | null;
  website: string | null;
  headshot_url: string | null;
  featured: boolean | null;
  expires_at?: string | null;
  archived_at?: string | null;
}

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
  let activeSpeakers: { id: string; name: string; expiresAt: string | null }[] =
    [];
  let pastSpeakers: PastSpeakerRow[] = [];
  let pendingInvites: PendingSpeakerInvite[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const FULL =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at";
    // Pre-migration fallback: lifecycle columns arrive with migration 0028.
    const LEGACY =
      "id, name, title, bio, industries, website, headshot_url, featured";
    let data = (
      await admin
        .from("speakers")
        .select(FULL)
        .order("featured", { ascending: false })
        .order("name")
    ).data as AdminSpeakerRow[] | null;
    if (!data) {
      data = (
        await admin
          .from("speakers")
          .select(LEGACY)
          .order("featured", { ascending: false })
          .order("name")
      ).data as AdminSpeakerRow[] | null;
    }
    const all = data ?? [];
    const isActive = (s: AdminSpeakerRow) =>
      sponsorActive({
        archivedAt: s.archived_at ?? null,
        expiresAt: s.expires_at ?? null,
      });

    rows = all.filter(isActive).map((s) => ({
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
    activeSpeakers = all.filter(isActive).map((s) => ({
      id: s.id,
      name: s.name,
      expiresAt: s.expires_at ?? null,
    }));
    pastSpeakers = all
      .filter((s) => !isActive(s))
      .map((s) => ({
        id: s.id,
        name: s.name,
        title: s.title ?? "",
        archivedAt: s.archived_at ?? null,
        expiresAt: s.expires_at ?? null,
      }));

    const { data: invites } = await admin
      .from("speaker_invites")
      .select("id, email, display_name, created_at")
      .is("completed_at", null)
      .order("created_at", { ascending: false });
    pendingInvites = (invites ?? []).map((i) => ({
      id: i.id as string,
      email: i.email as string,
      displayName: (i.display_name as string) ?? "",
      createdAt: i.created_at as string,
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
      <SpeakerLifecyclePanel
        activeSpeakers={activeSpeakers}
        pastSpeakers={pastSpeakers}
        pendingInvites={pendingInvites}
      />
      <SpeakersManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
