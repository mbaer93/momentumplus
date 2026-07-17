import { redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";

export const dynamic = "force-dynamic";

export const metadata = { title: "Networking | Momentum+" };

/*
 * Admin-only placeholder while the networking-group integration is being
 * negotiated. Members can't see the nav item, and direct URLs bounce them
 * back to the dashboard.
 */
export default async function NetworkingPage() {
  const member = await requireMember();
  if (!member.isAdmin) redirect("/dashboard");

  return (
    <div className="resources-pad">
      <div className="section-header">
        <div>
          <h2>Networking</h2>
          <p>Visible to admins only while the integration is decided</p>
        </div>
      </div>
      <div
        className="sessions-empty"
        style={{
          marginTop: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "48px 24px",
        }}
      >
        <span style={{ color: "var(--gold)" }}>
          <UsersIcon size={28} />
        </span>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          Placeholder — hidden from members
        </div>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          This tab is reserved for the networking-group partnership that&apos;s
          in discussion. Once the integration is decided, it gets built here
          and switched on for members.
        </div>
      </div>
    </div>
  );
}
