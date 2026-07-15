import { Sidebar } from "@/components/portal/Sidebar";
import { Topbar } from "@/components/portal/Topbar";
import { SponsorRail } from "@/components/sponsors/SponsorRail";
import { requireMember } from "@/lib/current-member";
import { listSponsors, railSponsors } from "@/lib/directory-queries";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires a signed-in member with an active (or in-grace) membership;
  // lapsed members land on /expired with renewal options (SPEC.md §5).
  const member = await requireMember();
  const [railList, allSponsors] = await Promise.all([
    railSponsors(),
    listSponsors(),
  ]);
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
    <div className="app-shell">
      <Sidebar
        userName={member.name}
        userInitials={member.initials}
        tierLabel={member.tierLabel}
        isAdmin={member.isAdmin}
        presentedBy={presentedBy}
      />
      <div className="main-area">
        <Topbar userInitials={member.initials} />
        <div className="content-area">
          {/* Sponsor rail renders on portal pages except community, profile,
              admin, and the live room (SPEC.md §5); it self-hides by route. */}
          <div className="with-rail">
            <div className="rail-content">{children}</div>
            <SponsorRail sponsors={rail} />
          </div>
        </div>
      </div>
    </div>
  );
}
