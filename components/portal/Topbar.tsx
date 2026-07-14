"use client";

import { usePathname } from "next/navigation";
import { BellIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { titleForPath } from "./nav";

interface TopbarProps {
  userInitials: string;
}

export function Topbar({ userInitials }: TopbarProps) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <span className="topbar-title">{titleForPath(pathname)}</span>
      <div className="topbar-search">
        <SearchIcon size={14} />
        <input type="text" placeholder="Search sessions, speakers..." />
      </div>
      <button
        className="topbar-icon-btn topbar-notif-dot"
        aria-label="Notifications"
        type="button"
      >
        <BellIcon size={16} />
      </button>
      <button className="topbar-icon-btn" aria-label="Settings" type="button">
        <SettingsIcon size={16} />
      </button>
      <div className="topbar-avatar">{userInitials}</div>
    </header>
  );
}
