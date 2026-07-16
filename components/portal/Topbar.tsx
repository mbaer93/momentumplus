"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { titleForPath } from "./nav";

export interface TopbarUpcoming {
  slug: string;
  title: string;
  dateLabel: string;
}

interface TopbarProps {
  userInitials: string;
  upcoming?: TopbarUpcoming[];
}

export function Topbar({ userInitials, upcoming = [] }: TopbarProps) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<"bell" | "avatar" | null>(null);
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
      <span className="topbar-title">{titleForPath(pathname)}</span>
      <div className="topbar-search">
        <SearchIcon size={14} />
        <input type="text" placeholder="Search sessions, speakers..." />
      </div>
      <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <button
          className="topbar-icon-btn"
          aria-label="Your upcoming sessions"
          title="Your upcoming sessions"
          type="button"
          onClick={() => setOpenMenu(openMenu === "bell" ? null : "bell")}
        >
          <BellIcon size={16} />
          {upcoming.length > 0 && <span className="topbar-dot" />}
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
          <div className="topbar-menu" style={{ minWidth: 260 }}>
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
