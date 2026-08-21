import { redirect } from "next/navigation";
import {
  SpeakerStudio,
  type StudioMonthCard,
  type StudioSession,
  type StudioVideo,
} from "@/components/speaker/SpeakerStudio";
import Link from "next/link";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { formatCents, speakerIsPaid, speakerMonthStats } from "@/lib/revenue";
import { getAgreementForSpeaker } from "@/lib/agreement-doc-db";
import {
  getSpeakerById,
  getSpeakerForUser,
  latestAdvisorAgreement,
  speakerProfileGaps,
} from "@/lib/speaker-tools";
import {
  agreementIsCurrent,
  agreementRequired,
  mustSignBeforeStudio,
} from "@/lib/advisor-agreement";
import { intakeRequired } from "@/lib/advisor-intake";
import { getAdvisorIntake } from "@/lib/advisor-intake-db";
import { tslsIntakeRequired } from "@/lib/tsls-intake";
import { getTslsIntake } from "@/lib/tsls-intake-db";
import { speakerLive, upcomingSeasonStart } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { formatAt } from "@/lib/time-format";

export const dynamic = "force-dynamic";
// Server actions on this page fan out per-member work — allow the full window.
export const maxDuration = 300;

export const metadata = { title: "Speaker Studio | Momentum+" };

/*
 * The speaker's own dashboard: edit their public speaker page and business
 * resource, manage their sessions (start Zoom as host, send notices and
 * resource emails to enrollees — recipient emails stay server-side), and
 * tidy their library items.
 */
export default async function SpeakerStudioPage(
  props: {
    searchParams?: Promise<{ error?: string; as?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const member = await requireMember();

  let speaker = null;
  let resource = {
    title: "",
    description: "",
    url: "",
    imageUrl: null as string | null,
  };
  let sessions: StudioSession[] = [];
  let videos: StudioVideo[] = [];
  let monthCard: StudioMonthCard | null = null;

  // Set when an admin is looking at a specific speaker's Studio.
  let previewAs: string | null = null;
  // Set for an Advisor whose signature is on file — a link back to it.
  let agreementSignedLabel: string | null = null;
  // Intake state — the Advisor session intake, or the TSLS Speaker Tech
  // Questionnaire for a mainstage speaker. Never both.
  let intakeState: { label: string; outstanding: boolean } | null = null;
  let intakeHref = "/speaker/intake";

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const user = await getAuthUser();
    if (!user) redirect("/login");

    /*
     * ?as=<speakerId>: an admin opening a speaker's Studio to see exactly
     * what that speaker sees (Matt, 2026-07-28). Admin check uses the REAL
     * profile, so this is unreachable from inside a view-as preview — which
     * is correct: view-as simulates a role, this inspects a person.
     */
    const asId = searchParams?.as?.trim();
    if (asId) {
      const access = await getAdminAccess();
      if (!access || !canAccessArea(access, "content")) redirect("/dashboard");
      speaker = await getSpeakerById(asId);
      // Archived/expired speakers have no Studio for anyone.
      if (!speaker) redirect("/admin/speakers");
      previewAs = speaker.name;
    } else {
      speaker = await getSpeakerForUser(user.id);
    }

    if (!speaker) {
      /*
       * No speaker row of your own. For a generic view-as "speaker" preview
       * that's expected — say so instead of silently bouncing to the
       * dashboard, which read as a bug. For a real admin, offer the list of
       * Studios they can open. Everyone else has no business here.
       */
      const access = await getAdminAccess();
      if (member.viewingAs || access) {
        const admin = createServiceClient();
        const { data: rows } = access
          ? await admin
              .from("speakers")
              .select("id, name, title")
              .is("archived_at", null)
              .order("name")
          : { data: [] };
        return (
          <div className="admin-pad">
            <div className="section-header">
              <div>
                <h2>Speaker Studio</h2>
                <p>
                  {member.viewingAs
                    ? "The role preview has no speaker page attached — a Studio always belongs to one real speaker. Exit the preview and open a specific speaker's Studio below or from Admin → Speakers."
                    : "You don't have a speaker page of your own. Open any speaker's Studio to see exactly what they see."}
                </p>
              </div>
            </div>
            {(rows ?? []).length > 0 && (
              <div className="card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <tbody>
                      {(rows ?? []).map((r) => (
                        <tr key={r.id as string}>
                          <td>
                            <div className="admin-row-title">
                              {r.name as string}
                            </div>
                            <div className="cc-sub">
                              {(r.title as string) ?? ""}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Link
                              className="btn-mini"
                              href={`/speaker?as=${r.id as string}`}
                            >
                              Open Studio
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      }
      redirect("/dashboard");
    }

    /*
     * The Leadership Advisor Agreement gate. An Advisor who hasn't signed the
     * current wording gets the agreement instead of the Studio — the contract
     * is what makes them an Advisor, so nothing in here is theirs until it's
     * signed. TSLS Main Speakers and admin-waived speakers pass straight
     * through (§1: the Advisor role is explicitly not a mainstage role).
     *
     * An admin inspecting someone via ?as= is NOT redirected: they're looking
     * at a speaker, not being asked to sign for them. Their view of the
     * agreement is /speaker/agreement?as=<id>, read-only.
     */
    // The gate reads the same currency the signing page does, so an
    // overridden Advisor is measured against THEIR wording (migration 0086).
    const [signedAgreement, agreementCurrency] = await Promise.all([
      latestAdvisorAgreement(speaker.id),
      getAgreementForSpeaker(speaker.id).then((a) => a.currency),
    ]);
    if (!previewAs && mustSignBeforeStudio(speaker, signedAgreement, agreementCurrency)) {
      redirect("/speaker/agreement");
    }
    /*
     * The other half of the gate (Matt, 2026-08-12): a complete profile. A
     * speaker page with no title, bio, topics or business is a broken page
     * on a public directory, and one shipped because the form asked for
     * nothing but a name. /speaker-onboarding collects exactly these fields
     * and now accepts an existing speaker, not just an invitee.
     *
     * As with the agreement, an admin inspecting someone via ?as= passes
     * through — they are looking, not editing, and bouncing THEM to a setup
     * form would be nonsense.
     */
    if (!previewAs && (await speakerProfileGaps(speaker, user.id)).length > 0) {
      redirect("/speaker-onboarding");
    }
    if (
      signedAgreement &&
      agreementRequired(speaker) &&
      agreementIsCurrent(signedAgreement, agreementCurrency)
    ) {
      agreementSignedLabel = new Date(
        signedAgreement.signedAt,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      });
    }

    /*
     * Session intake (§§2, 3, 4, 6, 12, 21, 22, 23). Unlike the agreement it
     * gates nothing — an Advisor can work in the Studio while it's still
     * half-filled — but an unstarted intake is worth a nudge, because SLC
     * can't schedule or promote a session it has no title for.
     */
    if (intakeRequired(speaker)) {
      const stored = await getAdvisorIntake(speaker.id);
      intakeState = stored.submittedAt
        ? { label: "Session intake — submitted", outstanding: false }
        : stored.exists
          ? { label: "Finish your session intake", outstanding: true }
          : { label: "Start your session intake", outstanding: true };
    }

    /*
     * A TSLS Main Speaker gets the Speaker Tech Questionnaire instead — the
     * mainstage form (stage, mics, dressing rooms, call times), mirrored
     * from Sierra's Jotform. The two are mutually exclusive by construction:
     * intakeRequired is !tslsMainSpeaker, tslsIntakeRequired is
     * tslsMainSpeaker, so exactly one link ever shows.
     */
    if (tslsIntakeRequired(speaker)) {
      const stored = await getTslsIntake(speaker.id);
      intakeState = stored.submittedAt
        ? { label: "Speaker Tech Questionnaire — submitted", outstanding: false }
        : stored.exists
          ? { label: "Finish your Speaker Tech Questionnaire", outstanding: true }
          : { label: "Start your Speaker Tech Questionnaire", outstanding: true };
      intakeHref = "/speaker/tsls-intake";
    }

    const admin = createServiceClient();
    const speakerId: string = speaker.id;

    /* Every session this speaker is on, not only the ones where they are
       sessions.speaker_id — a co-speaker's Studio has to list the sessions
       they actually present (migration 0087). Falls back to the legacy
       column when session_speakers isn't deployed yet. */
    async function ownSessions() {
      const SESSION_COLS = "id, title, starts_at, status, zoom_meeting_id";
      const viaLineup = await admin
        .from("sessions")
        .select(`${SESSION_COLS}, session_speakers!inner ( speaker_id )`)
        .eq("session_speakers.speaker_id", speakerId)
        .order("starts_at", { ascending: false });
      if (!viaLineup.error) return viaLineup;
      return admin
        .from("sessions")
        .select(SESSION_COLS)
        .eq("speaker_id", speakerId)
        .order("starts_at", { ascending: false });
    }

    const [{ data: sessionRows }, { data: resourceRow }] = await Promise.all([
      ownSessions(),
      speaker.resourceId
        ? admin
            .from("resources")
            .select("title, description, url, image_url")
            .eq("id", speaker.resourceId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const sessionIds = (sessionRows ?? []).map((s) => s.id as string);
    const [{ data: enrollCounts }, { data: videoRows }, resourceRes] = await Promise.all([
      sessionIds.length > 0
        ? admin
            .from("session_enrollment_counts")
            .select("session_id, enrolled")
            .in("session_id", sessionIds)
        : Promise.resolve({ data: [] as { session_id: string; enrolled: number }[] }),
      sessionIds.length > 0
        ? admin
            .from("videos")
            .select("id, title, category, published_at")
            .in("session_id", sessionIds)
        : Promise.resolve({ data: [] as { id: string; title: string; category: string | null; published_at: string | null }[] }),
      sessionIds.length > 0
        ? admin
            .from("session_resources")
            .select("id, session_id, name, type, url, sort")
            .in("session_id", sessionIds)
            .order("sort", { ascending: true })
        : Promise.resolve({ data: null, error: null }),
    ]);
    const counts = new Map(
      (enrollCounts ?? []).map((r) => [r.session_id as string, r.enrolled as number]),
    );
    // Pre-migration-0047: no table yet — sessions just show zero resources.
    const resourcesBySession = new Map<string, { id: string; name: string; type: string; url: string }[]>();
    for (const r of (!resourceRes.error && resourceRes.data) || []) {
      const list = resourcesBySession.get(r.session_id as string) ?? [];
      list.push({
        id: r.id as string,
        name: r.name as string,
        type: (r.type as string | null) ?? "Resource",
        url: r.url as string,
      });
      resourcesBySession.set(r.session_id as string, list);
    }
    sessions = (sessionRows ?? []).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      startsAt: (s.starts_at as string) ?? null,
      status: s.status as string,
      hasMeeting: Boolean(s.zoom_meeting_id),
      enrolled: counts.get(s.id as string) ?? 0,
      resources: resourcesBySession.get(s.id as string) ?? [],
    }));
    videos = (videoRows ?? []).map((v) => ({
      id: v.id as string,
      title: v.title as string,
      category: (v.category as string) ?? "",
      published: Boolean(v.published_at),
    }));
    if (resourceRow) {
      resource = {
        title: (resourceRow.title as string) ?? "",
        description: (resourceRow.description as string) ?? "",
        url: (resourceRow.url as string) ?? "",
        imageUrl: (resourceRow.image_url as string | null) ?? null,
      };
    }

    // Speaker-of-the-month card. TSLS Main Speakers see reach only (they're
    // unpaid); everyone else also sees their 15% share — unless an admin has
    // switched their payment access off (migration 0082), which takes the
    // money off the card for them too. The gate is here, on the server: with
    // paid=false the share is never computed and never reaches the browser,
    // so hiding it isn't left to the component.
    if (speaker.speakerMonth) {
      const paid = speakerIsPaid(speaker);
      const stats = await speakerMonthStats(speaker.speakerMonth, { paid });
      monthCard = {
        monthLabel: stats.monthLabel,
        memberCount: stats.memberCount,
        earningsLabel:
          stats.earningsCents !== null ? formatCents(stats.earningsCents) : null,
        note: speaker.tslsMainSpeaker
          ? "Member count excludes admins, speakers, and sponsors. As a TSLS Main Speaker your Momentum+ month is part of your Summit engagement."
          : !speaker.paymentAccess
            ? // Deliberately says nothing about a share this speaker does not
              // have — the number, not an explanation, is what's withheld.
              "Member count excludes admins, speakers, and sponsors."
            : stats.revenueCents === null
              ? "Member count excludes admins, speakers, and sponsors. Earnings appear once billing is connected."
              : stats.payableSpeakers > 1
                ? // A shared month splits ONE 15% share (§14). Say so, with
                  // the number: a speaker who expected the full figure needs
                  // to read why it halved, not guess the card is broken.
                  `Member count excludes admins, speakers, and sponsors. Earnings are 15% of membership revenue attributed to your month (longer plans are spread evenly across the months they cover), split evenly between the ${stats.payableSpeakers} speakers sharing this month; the figure settles when the month closes.`
                : "Member count excludes admins, speakers, and sponsors. Earnings are 15% of membership revenue attributed to your month (longer plans are spread evenly across the months they cover); the figure settles when the month closes.",
        inProgress: stats.inProgress,
      };
    }
  } else {
    // Preview mode: demo speaker so the Studio is explorable.
    speaker = {
      id: "demo",
      name: member.name,
      title: "Leadership Coach",
      bio: "Preview of your speaker bio.",
      industries: ["Leadership"],
      headshotUrl: null,
      resourceId: null,
      expiresAt: null,
    };
    sessions = [
      {
        id: "demo-1",
        title: "Resilience Rituals for High-Achievers",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        status: "scheduled",
        hasMeeting: true,
        enrolled: 23,
        resources: [
          { id: "r1", name: "Session workbook", type: "PDF", url: "#" },
        ],
      },
    ];
    videos = [
      { id: "v1", title: "Burnout Blueprint (recording)", category: "Wellness", published: true },
    ];
  }

  return (
    <SpeakerStudio
      speaker={{
        name: speaker.name,
        title: speaker.title,
        bio: speaker.bio,
        industries: speaker.industries.join(", "),
        expiresAt: speaker.expiresAt,
        headshotUrl: speaker.headshotUrl,
        // Pre-season truth: tell the speaker they're hidden until Oct 1
        // instead of letting them hunt for their missing public page.
        goLiveLabel:
          isSupabaseConfigured() &&
          !speakerLive({ archivedAt: null, expiresAt: speaker.expiresAt })
            ? formatAt(upcomingSeasonStart(), "dateLong")
            : null,
      }}
      resource={resource}
      sessions={sessions}
      videos={videos}
      startError={searchParams?.error ?? null}
      monthCard={monthCard}
      previewAs={previewAs}
      agreementSignedLabel={agreementSignedLabel}
      intake={intakeState}
      intakeHref={intakeHref}
    />
  );
}
