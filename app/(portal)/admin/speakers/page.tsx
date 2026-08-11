import { SpeakersManager } from "@/components/admin/SpeakersManager";
import { PullTslsSpeakersButton } from "@/components/admin/PullTslsSpeakersButton";
import {
  DuplicateSpeakersPanel,
  type DuplicateGroup,
} from "@/components/admin/DuplicateSpeakersPanel";
import { InviteAllSpeakersButton } from "@/components/admin/InviteAllSpeakersButton";
import {
  SpeakerLifecyclePanel,
  type PastSpeakerRow,
  type PendingSpeakerInvite,
} from "@/components/admin/SpeakerLifecyclePanel";
import type { EntityRow } from "@/components/admin/EntityManager";
import {} from "@/components/icons";
import { AGREEMENT_VERSION } from "@/lib/advisor-agreement";
import { intakeStatusBySpeaker } from "@/lib/advisor-intake-db";
import { tslsIntakeStatusBySpeaker } from "@/lib/tsls-intake-db";
import { getAdminAccess } from "@/lib/auth-helpers";
import { speakers as placeholderSpeakers } from "@/lib/directory-data";
import {
  formatCents,
  monthLabel,
  speakerIsPaid,
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
  payment_access?: boolean | null;
  advisor_agreement_waived?: boolean | null;
  contact_email?: string | null;
  profile_id?: string | null;
}

export default async function AdminSpeakersPage(
  props: {
    searchParams?: Promise<{ edit?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  let duplicateGroups: DuplicateGroup[] = [];
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
      // Preview mode has no database; show the switch in its real default.
      paymentAccess: true,
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
    paymentAccess: boolean;
    stats: SpeakerMonthStats;
  }[] = [];
  let isSuper = false;
  let uninvitedCount = 0;

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const FULL =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at, speaker_month, tsls_main_speaker, payment_access, advisor_agreement_waived, contact_email, profile_id";
    const PRE_0083 =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at, speaker_month, tsls_main_speaker, payment_access, contact_email, profile_id";
    // Pre-migration fallbacks: advisor_agreement_waived arrives with 0083,
    // payment_access arrives with 0082,
    // contact_email with 0074, month columns with 0053, lifecycle columns
    // with 0028 — degrade gracefully until each is run.
    const PRE_0082 =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at, speaker_month, tsls_main_speaker, contact_email, profile_id";
    const PRE_0074 =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at, speaker_month, tsls_main_speaker, profile_id";
    const PRE_0053 =
      "id, name, title, bio, industries, website, headshot_url, featured, expires_at, archived_at";
    const LEGACY =
      "id, name, title, bio, industries, website, headshot_url, featured";
    let data: AdminSpeakerRow[] | null = null;
    for (const columns of [FULL, PRE_0083, PRE_0082, PRE_0074, PRE_0053, LEGACY]) {
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

    // Two rows for one person — the shape a TSLS pull leaves behind when its
    // name matching misses (Matt, 2026-08-11). Session counts come along so
    // the admin can tell which row is the real one before merging.
    const { findLikelyDuplicates } = await import("@/lib/tsls-speakers");
    const dupeGroups = findLikelyDuplicates(
      all.map((s) => ({ id: String(s.id), name: String(s.name) })),
    );
    if (dupeGroups.length > 0) {
      const dupeIds = dupeGroups.flatMap((g) => g.rows.map((r) => r.id));
      const { data: dupeSessions } = await admin
        .from("sessions")
        .select("speaker_id")
        .in("speaker_id", dupeIds);
      const sessionCounts = new Map<string, number>();
      for (const row of dupeSessions ?? []) {
        const key = String(row.speaker_id);
        sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1);
      }
      const byId = new Map(all.map((s) => [String(s.id), s]));
      duplicateGroups = dupeGroups.map((g) => ({
        key: g.key,
        rows: g.rows.map((r) => {
          const full = byId.get(r.id);
          return {
            id: r.id,
            name: r.name,
            title: full?.title ?? null,
            createdAt: null,
            hasHeadshot: Boolean(full?.headshot_url),
            hasBio: Boolean(full?.bio),
            sessionCount: sessionCounts.get(r.id) ?? 0,
          };
        }),
      }));
    }
    const isActive = (s: AdminSpeakerRow) =>
      sponsorActive({
        archivedAt: s.archived_at ?? null,
        expiresAt: s.expires_at ?? null,
      });

    // Pending invites feed both the lifecycle panel and each row's
    // invite-state line, so load them before building the rows.
    const { data: invites } = await admin
      .from("speaker_invites")
      .select("id, email, display_name, created_at")
      .is("completed_at", null)
      .order("created_at", { ascending: false });
    const pendingEmails = new Set(
      (invites ?? []).map((i) => String(i.email).toLowerCase()),
    );

    /*
     * Leadership Advisor Agreement status, one query for everyone. Ordered
     * newest-first so the first row seen per speaker is their current
     * signature; §32 lets the agreement be amended, so a speaker can hold
     * several. `error` means migration 0083 hasn't run — every speaker then
     * reads as unsigned, which is the honest answer on a database with no
     * signature ledger.
     */
    const { data: signatureRows, error: signatureError } = await admin
      .from("advisor_agreements")
      .select("speaker_id, agreement_version, signed_at")
      .order("signed_at", { ascending: false });
    const latestSignature = new Map<string, { version: string; at: string }>();
    for (const s of (!signatureError && signatureRows) || []) {
      const id = s.speaker_id as string;
      if (!latestSignature.has(id)) {
        latestSignature.set(id, {
          version: s.agreement_version as string,
          at: s.signed_at as string,
        });
      }
    }
    const signedOn = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      });
    /*
     * Session-intake status, one query for everyone. TSLS Main Speakers are
     * not asked — theirs is the TSLS Speaker Tech Questionnaire in Jotform,
     * which Momentum+ does not track.
     */
    const [intakeStatus, tslsStatus] = await Promise.all([
      intakeStatusBySpeaker(),
      tslsIntakeStatusBySpeaker(),
    ]);
    const progressLine = (
      row: { submittedAt: string | null; updatedAt: string | null } | undefined,
    ): string => {
      if (!row) return "Not started.";
      if (!row.submittedAt) return "Draft saved, not submitted.";
      const updated =
        row.updatedAt && row.updatedAt.slice(0, 10) !== row.submittedAt.slice(0, 10)
          ? ` (last updated ${signedOn(row.updatedAt)})`
          : "";
      return `Submitted ${signedOn(row.submittedAt)}.${updated}`;
    };
    // Mainstage speakers answer the Speaker Tech Questionnaire; Advisors
    // answer the session intake. tsls_main_speaker decides which, so a
    // speaker is never chased for both.
    const intakeStatusOf = (s: AdminSpeakerRow): string =>
      s.tsls_main_speaker
        ? progressLine(tslsStatus.get(s.id))
        : progressLine(intakeStatus.get(s.id));
    const intakeLabelOf = (s: AdminSpeakerRow): string =>
      s.tsls_main_speaker ? "Speaker Tech Questionnaire" : "Session intake";
    const intakeHrefOf = (s: AdminSpeakerRow): string =>
      s.tsls_main_speaker
        ? `/speaker/tsls-intake?as=${s.id}`
        : `/speaker/intake?as=${s.id}`;

    const agreementStatusOf = (s: AdminSpeakerRow): string => {
      if (s.tsls_main_speaker) return "Not required — TSLS Main Speaker.";
      if (s.advisor_agreement_waived) return "Waived — no in-app signature needed.";
      const signature = latestSignature.get(s.id);
      if (!signature) return "Not signed — Speaker Studio is closed to them.";
      return signature.version === AGREEMENT_VERSION
        ? `Signed ${signedOn(signature.at)}.`
        : `Signed ${signedOn(signature.at)} against older wording — needs re-signing.`;
    };

    rows = all.filter(isActive).map((s) => ({
      id: s.id,
      title: s.name,
      subtitle: s.title ?? "",
      badge: s.featured ? "Featured" : undefined,
      values: {
        name: s.name,
        title: s.title ?? "",
        industries: (s.industries ?? []).join(", "),
        contactEmail: s.contact_email ?? "",
        website: s.website ?? "",
        bio: s.bio ?? "",
        featured: Boolean(s.featured),
        headshotUrl: s.headshot_url ?? "",
        speakerMonth: s.speaker_month ?? "",
        tslsMainSpeaker: Boolean(s.tsls_main_speaker),
        // Only an explicit false is "off": a null column (pre-0082) has to
        // show the switch ON, or an admin saving an unrelated edit would
        // quietly strip payment access from every speaker.
        paymentAccess: s.payment_access !== false,
        // Mirror image of the line above: only an explicit true is a waiver,
        // so a null column (pre-0083) leaves the agreement required.
        advisorAgreementWaived: s.advisor_agreement_waived === true,
        hasAccount: Boolean(s.profile_id),
        invitePending: Boolean(
          s.contact_email &&
            pendingEmails.has(String(s.contact_email).toLowerCase()),
        ),
        agreementStatus: agreementStatusOf(s),
        intakeStatus: intakeStatusOf(s),
        intakeLabel: intakeLabelOf(s),
        intakeHref: intakeHrefOf(s),
      },
    }));
    uninvitedCount = all.filter(
      (s) =>
        isActive(s) &&
        !s.profile_id &&
        s.contact_email &&
        !pendingEmails.has(String(s.contact_email).toLowerCase()),
    ).length;
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
          assigned.map(async (s) => {
            const flags = {
              tslsMainSpeaker: Boolean(s.tsls_main_speaker),
              paymentAccess: s.payment_access !== false,
            };
            return {
              name: s.name,
              main: flags.tslsMainSpeaker,
              paymentAccess: flags.paymentAccess,
              stats: await speakerMonthStats(s.speaker_month as string, {
                paid: speakerIsPaid(flags),
              }),
            };
          }),
        )
      ).sort((a, b) => a.stats.monthKey.localeCompare(b.stats.monthKey));
    }
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Speakers</h2>
          <p>Profiles shown in the member speaker directory</p>
        </div>
        {/* All TSLS speakers (main stage + panelists) belong here too; the
            Emcee is the one exception and is skipped by the pull. Login
            invites go out only when an admin clicks — per speaker in the
            editor, or everyone at once here. */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <InviteAllSpeakersButton uninvitedCount={uninvitedCount} />
          <PullTslsSpeakersButton />
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample speakers. Changes persist once Supabase is
          connected.
        </div>
      )}
      <DuplicateSpeakersPanel groups={duplicateGroups} />
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
          <p style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginBottom: 10 }}>
            The same numbers each speaker sees in their Studio: members on
            the platform in their month (excluding admins, speakers, and
            sponsors) and 15% of that month&apos;s monthly-equivalent
            membership revenue. TSLS Main Speakers are unpaid, as is anyone
            whose payment access is switched off in their editor below.
            In-progress months keep moving until the month closes.
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
                      {!r.main && !r.paymentAccess ? " (payment access off)" : ""}
                    </td>
                    <td>{r.stats.memberCount}</td>
                    <td>
                      {r.stats.revenueCents === null
                        ? "Stripe not connected"
                        : formatCents(r.stats.revenueCents)}
                    </td>
                    <td>
                      {r.main || !r.paymentAccess
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
