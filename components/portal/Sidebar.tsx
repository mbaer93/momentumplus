"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "./nav";
import { SettingsIcon } from "@/components/icons";

interface SidebarProps {
  userName: string;
  userInitials: string;
  tierLabel: string;
  isAdmin: boolean;
}

export function Sidebar({
  userName,
  userInitials,
  tierLabel,
  isAdmin,
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

      <div className="sidebar-footer">
        <Link href="/profile" className="nav-item">
          <SettingsIcon size={16} />
          Settings
        </Link>
      </div>
    </aside>
  );
}
