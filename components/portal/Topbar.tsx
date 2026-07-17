"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { markNotificationsRead } from "@/app/(portal)/community/actions";
import { titleForPath } from "./nav";
import { MobileNavToggle } from "./PortalNav";

export interface TopbarUpcoming {
  slug: string;
  title: string;
  dateLabel: string;
}

export interface TopbarNotification {
  id: string;
  title: string;
  body: string;
  link: string;
  unread: boolean;
  dateLabel: string;
}

interface TopbarProps {
  userInitials: string;
  upcoming?: TopbarUpcoming[];
  notifications?: TopbarNotification[];
}

export function Topbar({
  userInitials,
  upcoming = [],
  notifications = [],
}: TopbarProps) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<"bell" | "avatar" | null>(null);
  // Cleared locally the moment the bell opens; the server marks rows read.
  const [seen, setSeen] = useState(false);
  const unreadCount = seen ? 0 : notifications.filter((n) => n.unread).length;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setOpenMenu(null), [pathname]);
  useEffect(() => {
    if (!openMenu) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenu]);

  return (
    <header className="topbar">
      <MobileNavToggle />
      <span className="topbar-title">{titleForPath(pathname)}</span>
      {/* Submits to /search — this box was decorative for far too long. */}
      <form className="topbar-search" action="/search" method="get">
        <SearchIcon size={14} />
        <input
          type="search"
          name="q"
          placeholder="Search sessions, speakers..."
          aria-label="Search Momentum+"
        />
      </form>
      <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <button
          className="topbar-icon-btn"
          aria-label="Notifications and upcoming sessions"
          title="Notifications & upcoming sessions"
          type="button"
          onClick={() => {
            const opening = openMenu !== "bell";
            setOpenMenu(opening ? "bell" : null);
            if (opening && unreadCount > 0) {
              setSeen(true);
              void markNotificationsRead().catch(() => undefined);
            }
          }}
        >
          <BellIcon size={16} />
          {(unreadCount > 0 || upcoming.length > 0) && (
            <span className="topbar-dot" />
          )}
        </button>
        <Link
          href="/profile"
          className="topbar-icon-btn"
          aria-label="Profile and preferences"
          title="Profile & notification preferences"
        >
          <SettingsIcon size={16} />
        </Link>
        <button
          type="button"
          className="topbar-avatar"
          aria-label="Account menu"
          title="Account"
          onClick={() => setOpenMenu(openMenu === "avatar" ? null : "avatar")}
          style={{ border: "none", cursor: "pointer" }}
        >
          {userInitials}
        </button>

        {openMenu === "bell" && (
          <div className="topbar-menu" style={{ minWidth: 280 }}>
            {notifications.length > 0 && (
              <>
                <div className="topbar-menu-title">Notifications</div>
                {notifications.slice(0, 5).map((n) => (
                  <Link
                    key={n.id}
                    href={n.link || "/dashboard"}
                    className="topbar-menu-item"
                    style={n.unread && !seen ? { background: "var(--gold-pale)" } : undefined}
                  >
                    <span className="topbar-menu-item-title">{n.title}</span>
                    <span className="topbar-menu-item-sub">
                      {n.body ? `${n.body} · ` : ""}
                      {n.dateLabel}
                    </span>
                  </Link>
                ))}
              </>
            )}
            <div className="topbar-menu-title">Your upcoming sessions</div>
            {upcoming.length === 0 ? (
              <Link href="/sessions" className="topbar-menu-item">
                Nothing on your calendar yet — browse sessions
              </Link>
            ) : (
              upcoming.map((s) => (
                <Link
                  key={s.slug}
                  href={`/sessions/${s.slug}`}
                  className="topbar-menu-item"
                >
                  <span className="topbar-menu-item-title">{s.title}</span>
                  <span className="topbar-menu-item-sub">{s.dateLabel}</span>
                </Link>
              ))
            )}
            <Link href="/calendar" className="topbar-menu-item" style={{ color: "var(--gold)" }}>
              Open calendar
            </Link>
          </div>
        )}

        {openMenu === "avatar" && (
          <div className="topbar-menu">
            <Link href="/profile" className="topbar-menu-item">
              My profile
            </Link>
            <form action="/auth/signout" method="post" style={{ margin: 0 }}>
              <button type="submit" className="topbar-menu-item topbar-menu-btn">
                Log out
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
