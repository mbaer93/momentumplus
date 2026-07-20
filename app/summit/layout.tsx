import type { Metadata } from "next";
import Link from "next/link";
import { SummitTabBar } from "@/components/summit/SummitTabBar";
import { requireMember } from "@/lib/current-member";
import { getSummitSettings } from "@/lib/summit-queries";

/*
 * TSLS Summit companion shell — deliberately separate from the Momentum+
 * portal (own header, own bottom-tab navigation, no sidebar/sponsor rail).
 * It shares the login and database, and links across to Momentum+ with one
 * button; nothing in the portal chrome is reused or altered.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TSLS Summit Companion",
  description:
    "Your in-person companion for the Tri-State Leadership Summit — agenda, speakers, vendors, community, and your ticket.",
};

export default async function SummitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same gate as the portal: signed-in member with active access. Summit
  // attendees get time-limited access through the existing sheet import.
  const member = await requireMember();
  const settings = await getSummitSettings();

  return (
    <div className="tsls-shell">
      <header className="tsls-header">
        <Link href="/summit" className="tsls-brand">
          <span className="tsls-brand-name">TSLS</span>
          <span className="tsls-brand-sub">
            {settings.name.replace(/^The\s+/i, "")}
          </span>
        </Link>
        <div className="tsls-header-actions">
          {member.isAdmin && (
            <Link href="/summit/admin" className="tsls-header-admin">
              Admin
            </Link>
          )}
          <Link href="/dashboard" className="tsls-momentum-btn">
            Momentum<span>+</span>
          </Link>
        </div>
      </header>
      <SummitTabBar />
      <main className="tsls-main">{children}</main>
    </div>
  );
}
