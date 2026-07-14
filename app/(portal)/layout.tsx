import { Sidebar } from "@/components/portal/Sidebar";
import { Topbar } from "@/components/portal/Topbar";
import { getCurrentMember } from "@/lib/current-member";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const member = await getCurrentMember();

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
