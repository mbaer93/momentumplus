import { HelpChat } from "@/components/help/HelpChat";
import {
  MobileNavBackdrop,
  PortalNavProvider,
} from "@/components/portal/PortalNav";
import { Sidebar } from "@/components/portal/Sidebar";
import { Topbar, type TopbarUpcoming } from "@/components/portal/Topbar";
import { SponsorRail } from "@/components/sponsors/SponsorRail";
import { requireMember } from "@/lib/current-member";
import { listSponsors, railSponsors } from "@/lib/directory-queries";
import { getPresentedByLogoUrl } from "@/lib/presented-by";
import { listSessions } from "@/lib/sessions/queries";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires a signed-in member with an active (or in-grace) membership;
  // lapsed members land on /expired with renewal options (SPEC.md §5).
  const member = await requireMember();
  const [railList, allSponsors, presentedByLogoUrl, sessions] =
    await Promise.all([
      railSponsors(),
      listSponsors(),
      getPresentedByLogoUrl(),
      listSessions(),
    ]);
  // Bell dropdown: the member's next few enrolled sessions.
  const upcoming: TopbarUpcoming[] = sessions
    .filter((s) => s.isEnrolled && new Date(s.startsAt).getTime() > Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4)
    .map((s) => ({
      slug: s.slug,
      title: s.title,
      dateLabel: new Date(s.startsAt).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    }));
  // The Momentum+ Sponsor (title tier) is "Presented by" on the left (logo)
  // and always leads the right-hand rail, where its ad creative renders.
  const presentedBy =
    allSponsors.find((s) => s.tier === "title" && s.railActive) ??
    allSponsors.find((s) => s.tier === "title") ??
    null;
  const rail =
    presentedBy && !railList.some((s) => s.id === presentedBy.id)
      ? [presentedBy, ...railList].slice(0, 3)
      : railList;

  return (
    <PortalNavProvider>
      <MobileNavBackdrop />
      <Sidebar
        userName={member.name}
        userInitials={member.initials}
        tierLabel={member.tierLabel}
        isAdmin={member.isAdmin}
        presentedBy={presentedBy}
        presentedByLogoUrl={presentedByLogoUrl}
      />
      <div className="main-area">
        <Topbar userInitials={member.initials} upcoming={upcoming} />
        <div className="content-area">
          {/* Sponsor rail renders on portal pages except community, profile,
              admin, and the live room (SPEC.md §5); it self-hides by route. */}
          <div className="with-rail">
            <div className="rail-content">{children}</div>
            <SponsorRail sponsors={rail} />
          </div>
        </div>
      </div>
      <HelpChat />
    </PortalNavProvider>
  );
}
