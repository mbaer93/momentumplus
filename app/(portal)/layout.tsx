import { Sidebar } from "@/components/portal/Sidebar";
import { Topbar } from "@/components/portal/Topbar";
import { requireMember } from "@/lib/current-member";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Requires a signed-in member with an active (or in-grace) membership;
  // lapsed members land on /expired with renewal options (SPEC.md §5).
  const member = await requireMember();

  return (
    <div className="app-shell">
      <Sidebar
        userName={member.name}
        userInitials={member.initials}
        tierLabel={member.tierLabel}
        isAdmin={member.isAdmin}
      />
      <div className="main-area">
        <Topbar userInitials={member.initials} />
        <div className="content-area">{children}</div>
      </div>
    </div>
  );
}
