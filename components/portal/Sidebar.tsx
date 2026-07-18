"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "./nav";
import { MobileNavClose } from "./PortalNav";
import { SettingsIcon } from "@/components/icons";
import { SponsorMark } from "@/components/sponsors/SponsorMark";
import type { SponsorItem } from "@/lib/directory-data";

interface SidebarProps {
  userName: string;
  userInitials: string;
  tierLabel: string;
  isAdmin: boolean;
  isSpeaker?: boolean;
  isSponsorManager?: boolean;
  /** Momentum+ Sponsor shown in the left-panel "Presented by" slot (logo
      mark; the ad creative lives in the right-hand rail). Clicks lead to the
      sponsor's profile on /sponsors, where the website link lives. */
  presentedBy?: Pick<SponsorItem, "id" | "name" | "logoUrl" | "wordmark"> | null;
  /** Dedicated logo uploaded specifically for this slot (fills it exactly);
      falls back to the sponsor's regular logo/name mark when absent. */
  presentedByLogoUrl?: string | null;
}

export function Sidebar({
  userName,
  userInitials,
  tierLabel,
  isAdmin,
  isSpeaker = false,
  isSponsorManager = false,
  presentedBy,
  presentedByLogoUrl,
}: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-name">
          Momentum<span style={{ color: "var(--gold)" }}>+</span>
        </div>
        <div className="sidebar-brand-sub">Premium Member Portal</div>
        <MobileNavClose />
      </div>

      <div className="sidebar-user">
        <div className="sidebar-avatar">{userInitials}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{userName}</div>
          <div className="sidebar-user-tier">{tierLabel}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(
            (item) =>
              (!item.adminOnly || isAdmin) &&
              (!item.speakerOnly || isSpeaker) &&
              (!item.sponsorOnly || isSponsorManager),
          );
          if (items.length === 0) return null;
          return (
            <div key={section.label}>
              <div className="nav-section-label">{section.label}</div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${isActive(item.href) ? " active" : ""}`}
                  >
                    <Icon size={16} />
                    {item.label}
                    {item.badge && (
                      <span
                        className={`nav-badge${
                          item.badge.variant === "blue" ? " blue" : ""
                        }`}
                      >
                        {item.badge.text}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {presentedBy || presentedByLogoUrl ? (
        <Link
          className="sidebar-sponsor"
          href={presentedBy ? `/sponsors/${presentedBy.id}` : "/sponsors"}
          title={presentedBy?.name ?? "Momentum+ Sponsor"}
        >
          <span className="sidebar-sponsor-label">Presented by</span>
          {presentedByLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="sidebar-presented-logo"
              src={presentedByLogoUrl}
              alt={`${presentedBy?.name ?? "Momentum+ Sponsor"} logo`}
            />
          ) : presentedBy ? (
            <span className="sidebar-sponsor-mark">
              <SponsorMark
                name={presentedBy.name}
                logoUrl={presentedBy.logoUrl}
                wordmark={presentedBy.wordmark}
                maxHeight={34}
              />
            </span>
          ) : null}
        </Link>
      ) : null}
      <div className="sidebar-footer">
        <Link href="/profile" className="nav-item">
          <SettingsIcon size={16} />
          Settings
        </Link>
      </div>
    </aside>
  );
}
