import { redirect } from "next/navigation";
import {
  SpeakerStudio,
  type StudioMonthCard,
  type StudioSession,
  type StudioVideo,
} from "@/components/speaker/SpeakerStudio";
import { requireMember } from "@/lib/current-member";
import { formatCents, speakerMonthStats } from "@/lib/revenue";
import { getSpeakerForUser } from "@/lib/speaker-tools";
import { speakerLive, upcomingSeasonStart } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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
export default async function SpeakerStudioPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
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

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    speaker = await getSpeakerForUser(user.id);
    if (!speaker) redirect("/dashboard");

    const admin = createServiceClient();
    const [{ data: sessionRows }, { data: resourceRow }] = await Promise.all([
      admin
        .from("sessions")
        .select("id, title, starts_at, status, zoom_meeting_id")
        .eq("speaker_id", speaker.id)
        .order("starts_at", { ascending: false }),
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
    // unpaid); everyone else also sees their 15% share.
    if (speaker.speakerMonth) {
      const stats = await speakerMonthStats(speaker.speakerMonth, {
        paid: !speaker.tslsMainSpeaker,
      });
      monthCard = {
        monthLabel: stats.monthLabel,
        memberCount: stats.memberCount,
        earningsLabel:
          stats.earningsCents !== null ? formatCents(stats.earningsCents) : null,
        note: speaker.tslsMainSpeaker
          ? "Member count excludes admins, speakers, and sponsors. As a TSLS Main Speaker your Momentum+ month is part of your Summit engagement."
          : stats.revenueCents === null
            ? "Member count excludes admins, speakers, and sponsors. Earnings appear once billing is connected."
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
            ? upcomingSeasonStart().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : null,
      }}
      resource={resource}
      sessions={sessions}
      videos={videos}
      startError={searchParams?.error ?? null}
      monthCard={monthCard}
    />
  );
}
