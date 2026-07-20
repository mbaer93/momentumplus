import Link from "next/link";
import { SummitTabBar } from "@/components/summit/SummitTabBar";
import { requireMember } from "@/lib/current-member";
import { momentumUrl } from "@/lib/momentum";
import { getSummitSettings } from "@/lib/summit-queries";

/*
 * The signed-in shell: sticky event header, tab navigation (bottom bar on
 * phones), and the one-tap jump to the Momentum+ platform — which is a
 * separate deployment on its own domain.
 */

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const member = await requireMember();
  const settings = await getSummitSettings();

  return (
    <div className="tsls-shell">
      <header className="tsls-header">
        <Link href="/" className="tsls-brand">
          <span className="tsls-brand-name">TSLS</span>
          <span className="tsls-brand-sub">
            {settings.name.replace(/^The\s+/i, "")}
          </span>
        </Link>
        <div className="tsls-header-actions">
          {member.isAdmin && (
            <Link href="/admin" className="tsls-header-admin">
              Admin
            </Link>
          )}
          <a href={momentumUrl("/dashboard")} className="tsls-momentum-btn">
            Momentum<span>+</span>
          </a>
        </div>
      </header>
      <SummitTabBar />
      <main className="tsls-main">{children}</main>
    </div>
  );
}
