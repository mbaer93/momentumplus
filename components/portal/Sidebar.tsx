"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "./nav";
import { SettingsIcon } from "@/components/icons";
import { SponsorMark } from "@/components/sponsors/SponsorMark";
import { SPONSOR_INTEREST_URL } from "@/lib/links";
import type { SponsorItem } from "@/lib/directory-data";

interface SidebarProps {
  userName: string;
  userInitials: string;
  tierLabel: string;
  isAdmin: boolean;
  /** Sponsor shown in the left-panel ad slot. Uses the uploaded sidebar ad
      creative when present; falls back to the logo/wordmark. */
  presentedBy?: Pick<
    SponsorItem,
    "name" | "logoUrl" | "sidebarAdUrl" | "wordmark" | "website"
  > | null;
}

export function Sidebar({
  userName,
  userInitials,
  tierLabel,
  isAdmin,
  presentedBy,
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
            (item) => !item.adminOnly || isAdmin,
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

      {presentedBy ? (
        <a
          className="sidebar-sponsor"
          href={presentedBy.website || SPONSOR_INTEREST_URL}
          target="_blank"
          rel="noopener noreferrer sponsored"
          title={presentedBy.name}
        >
          <span className="sidebar-sponsor-label">Presented by</span>
          {presentedBy.sidebarAdUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="sidebar-sponsor-ad"
              src={presentedBy.sidebarAdUrl}
              alt={`${presentedBy.name} — sponsor`}
            />
          ) : (
            <span className="sidebar-sponsor-mark">
              <SponsorMark
                name={presentedBy.name}
                logoUrl={presentedBy.logoUrl}
                wordmark={presentedBy.wordmark}
                maxHeight={34}
              />
            </span>
          )}
        </a>
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
