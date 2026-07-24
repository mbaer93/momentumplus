import Link from "next/link";
import { SpeakersManager } from "@/components/admin/SpeakersManager";
import {
  SpeakerLifecyclePanel,
  type PastSpeakerRow,
  type PendingSpeakerInvite,
} from "@/components/admin/SpeakerLifecyclePanel";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/auth-helpers";
import { speakers as placeholderSpeakers } from "@/lib/directory-data";
import {
  formatCents,
  monthLabel,
  speakerMonthStats,
  type SpeakerMonthStats,
} from "@/lib/revenue";
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
  speaker_month?: string | null;
  tsls_main_speaker?: boolean | null;
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
  // Super Admin only: month assignments with the same numbers the speakers
  // see in their Studio (member count, monthly-equivalent revenue, 15%).
  let monthRows: {
    name: string;
    main: boolean;
    stats: SpeakerMonthStats;
  }[] = [];
  let isSuper = false;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const FULL =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at, speaker_month, tsls_main_speaker";
    // Pre-migration fallbacks: month columns arrive with 0053, lifecycle
    // columns with 0028 — degrade gracefully until each is run.
    const PRE_0053 =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at";
    const LEGACY =
      "id, name, title, bio, industries, website, headshot_url, featured";
    let data: AdminSpeakerRow[] | null = null;
    for (const columns of [FULL, PRE_0053, LEGACY]) {
      data = (
        await admin
          .from("speakers")
          .select(columns)
          .order("featured", { ascending: false })
          .order("name")
      ).data as AdminSpeakerRow[] | null;
      if (data) break;
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
        speakerMonth: s.speaker_month ?? "",
        tslsMainSpeaker: Boolean(s.tsls_main_speaker),
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

    const access = await getAdminAccess();
    isSuper = access?.role === "super";
    if (isSuper) {
      const assigned = all.filter((s) => isActive(s) && s.speaker_month);
      monthRows = (
        await Promise.all(
          assigned.map(async (s) => ({
            name: s.name,
            main: Boolean(s.tsls_main_speaker),
            stats: await speakerMonthStats(s.speaker_month as string, {
              paid: !s.tsls_main_speaker,
            }),
          })),
        )
      ).sort((a, b) => a.stats.monthKey.localeCompare(b.stats.monthKey));
    }
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
      {isSuper && monthRows.length > 0 && (
        <div style={{ margin: "18px 0 24px" }}>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>
            Speaker of the Month — members &amp; earnings
          </h3>
          <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
            The same numbers each speaker sees in their Studio: members on
            the platform in their month (excluding admins, speakers, and
            sponsors) and 15% of that month&apos;s monthly-equivalent
            membership revenue. TSLS Main Speakers are unpaid. In-progress
            months keep moving until the month closes.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Speaker</th>
                  <th>Members</th>
                  <th>Month revenue</th>
                  <th>Earnings (15%)</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => (
                  <tr key={`${r.stats.monthKey}-${r.name}`}>
                    <td>
                      {monthLabel(r.stats.monthKey)}
                      {r.stats.inProgress ? " · in progress" : ""}
                    </td>
                    <td>
                      {r.name}
                      {r.main ? " (TSLS Main Speaker)" : ""}
                    </td>
                    <td>{r.stats.memberCount}</td>
                    <td>
                      {r.stats.revenueCents === null
                        ? "Stripe not connected"
                        : formatCents(r.stats.revenueCents)}
                    </td>
                    <td>
                      {r.main
                        ? "—"
                        : r.stats.earningsCents === null
                          ? "—"
                          : formatCents(r.stats.earningsCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <SpeakersManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
