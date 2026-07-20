import { HelpChat } from "@/components/help/HelpChat";
import {
  MobileNavBackdrop,
  PortalNavProvider,
} from "@/components/portal/PortalNav";
import { Sidebar } from "@/components/portal/Sidebar";
import {
  Topbar,
  type TopbarNotification,
  type TopbarUpcoming,
} from "@/components/portal/Topbar";
import { SponsorRail } from "@/components/sponsors/SponsorRail";
import { isPro } from "@/lib/access";
import { requireMember } from "@/lib/current-member";
import { listSponsors } from "@/lib/directory-queries";
import { getPresentedByLogoUrl } from "@/lib/presented-by";
import { listSessions } from "@/lib/sessions/queries";
import { RAIL_TIERS } from "@/lib/sponsor-tiers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Bell dropdown: the member's next few enrolled sessions. One light query
 * (own enrollments joined to session metadata) — the layout previously
 * pulled the entire session catalog plus every enrollment row in the
 * database on every page view just to render these four lines.
 */
async function upcomingEnrolled(): Promise<TopbarUpcoming[]> {
  const label = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });

  if (!isSupabaseConfigured()) {
    // Preview mode keeps the demo behavior via the placeholder dataset.
    const sessions = await listSessions();
    return sessions
      .filter(
        (s) => s.isEnrolled && new Date(s.startsAt).getTime() > Date.now(),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 4)
      .map((s) => ({ slug: s.slug, title: s.title, dateLabel: label(s.startsAt) }));
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  type EnrolledSession = {
    id: string;
    title: string;
    starts_at: string | null;
    duration_min?: number | null;
    recurrence?: string | null;
    recurrence_until?: string | null;
  };
  let res = await supabase
    .from("enrollments")
    .select(
      "sessions ( id, title, starts_at, duration_min, recurrence, recurrence_until )",
    )
    .eq("profile_id", user.id);
  if (res.error && /recurrence|duration_min/.test(res.error.message)) {
    res = (await supabase
      .from("enrollments")
      .select("sessions ( id, title, starts_at )")
      .eq("profile_id", user.id)) as typeof res;
  }
  const { nextOccurrence } = await import("@/lib/recurrence");
  const rows = (res.data ?? [])
    .map((r) => {
      const s = r.sessions as unknown as
        | EnrolledSession
        | EnrolledSession[]
        | null;
      return Array.isArray(s) ? s[0] : s;
    })
    .map((s) => {
      if (!s?.starts_at) return null;
      // A recurring series counts as upcoming at its NEXT occurrence — the
      // raw starts_at is the series start, which is soon in the past.
      const rec =
        s.recurrence === "weekly" ||
        s.recurrence === "biweekly" ||
        s.recurrence === "monthly"
          ? s.recurrence
          : null;
      const effective = rec
        ? nextOccurrence(
            s.starts_at,
            s.duration_min ?? 60,
            rec,
            s.recurrence_until ?? null,
          )
        : s.starts_at;
      if (!effective) return null;
      return { id: s.id, title: s.title, starts_at: effective };
    })
    .filter(
      (s): s is { id: string; title: string; starts_at: string } =>
        Boolean(s) && new Date(s!.starts_at).getTime() > Date.now(),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 4);
  return rows.map((s) => ({
    slug: s.id,
    title: s.title,
    dateLabel: label(s.starts_at),
  }));
}

/** The member's recent in-app notifications for the bell menu (own rows via
    RLS): speaker questions, announcements, whatever lands in the table. */
async function recentNotifications(): Promise<TopbarNotification[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  // Unread first so nothing unread hides behind read rows, then newest.
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .eq("profile_id", user.id)
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []).map((n) => ({
    id: n.id as string,
    title: (n.title as string) ?? "Notification",
    body: (n.body as string) ?? "",
    link: (n.link as string) ?? "/dashboard",
    unread: !n.read_at,
    dateLabel: new Date(n.created_at as string).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires a signed-in member with an active (or in-grace) membership;
  // lapsed members land on /expired with renewal options (SPEC.md §5).
  const member = await requireMember();
  const [allSponsors, presentedByLogoUrl, upcoming, notifications] =
    await Promise.all([
      listSponsors(),
      getPresentedByLogoUrl(),
      upcomingEnrolled(),
      recentNotifications(),
    ]);
  // The Momentum+ Sponsor is "Presented by" on the left (logo) and always
  // leads the right-hand rail, where its ad creative renders. Rail ads are
  // reserved for the top tiers only — Momentum+ Sponsor, Title, Platinum.
  const railList = allSponsors
    .filter((s) => s.railActive && RAIL_TIERS.has(s.tier))
    .slice(0, 3);
  const presentedBy =
    allSponsors.find((s) => s.tier === "momentum_plus" && s.railActive) ??
    allSponsors.find((s) => s.tier === "momentum_plus") ??
    null;
  const rail =
    presentedBy && !railList.some((s) => s.id === presentedBy.id)
      ? [presentedBy, ...railList].slice(0, 3)
      : railList;
  // Members below Pro get the upgrade card at the top of the rail. Speakers
  // are excluded — their comped season isn't an upsell target.
  const showUpgrade = !isPro(member.tier) && member.tier !== "speaker";

  return (
    <PortalNavProvider>
      <MobileNavBackdrop />
      <Sidebar
        userName={member.name}
        userInitials={member.initials}
        tierLabel={member.tierLabel}
        isAdmin={member.isAdmin}
        isSpeaker={member.isSpeaker}
        isSponsorManager={member.isSponsorManager}
        presentedBy={presentedBy}
        presentedByLogoUrl={presentedByLogoUrl}
      />
      <div className="main-area">
        <Topbar
          userInitials={member.initials}
          upcoming={upcoming}
          notifications={notifications}
        />
        <div className="content-area">
          {/* Sponsor rail renders on portal pages except community, profile,
              admin, and the live room (SPEC.md §5); it self-hides by route. */}
          <div className="with-rail">
            <div className="rail-content">{children}</div>
            <SponsorRail sponsors={rail} showUpgrade={showUpgrade} />
          </div>
        </div>
      </div>
      <HelpChat />
    </PortalNavProvider>
  );
}
