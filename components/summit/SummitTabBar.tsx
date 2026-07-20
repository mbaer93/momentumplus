"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AgendaIcon,
  SpeakersMicIcon,
  SummitHomeIcon,
  TicketIcon,
  VendorsIcon,
} from "./icons";

/*
 * Phone-first bottom tab bar for the summit companion — the primary
 * navigation while attendees are walking the venue. Fixed to the bottom on
 * phones (thumb reach); on desktop the same items render as a top nav row
 * under the header (see .tsls-tabbar CSS).
 */

const TABS = [
  { href: "/summit", label: "Home", icon: SummitHomeIcon },
  { href: "/summit/agenda", label: "Agenda", icon: AgendaIcon },
  { href: "/summit/speakers", label: "Speakers", icon: SpeakersMicIcon },
  { href: "/summit/vendors", label: "Vendors", icon: VendorsIcon },
  { href: "/summit/ticket", label: "My Ticket", icon: TicketIcon },
];

export function SummitTabBar() {
  const pathname = usePathname();
  // Longest matching prefix wins so /summit/agenda doesn't also light Home.
  const active = TABS.reduce<string>((best, t) => {
    const match = pathname === t.href || pathname.startsWith(`${t.href}/`);
    return match && t.href.length > best.length ? t.href : best;
  }, "");

  return (
    <nav className="tsls-tabbar" aria-label="Summit navigation">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`tsls-tab${active === t.href ? " active" : ""}`}
            aria-current={active === t.href ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
