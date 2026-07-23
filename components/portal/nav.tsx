import type { ComponentType } from "react";
import {
  AdminIcon,
  BriefcaseIcon,
  CalendarIcon,
  CommunityIcon,
  DashboardIcon,
  EducationIcon,
  LibraryIcon,
  ProfileIcon,
  ResourcesIcon,
  SessionsIcon,
  SpeakersIcon,
  SponsorsIcon,
  StarIcon,
  TargetIcon,
  UsersIcon,
} from "@/components/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number }>;
  badge?: { text: string; variant?: "gold" | "blue" };
  adminOnly?: boolean;
  speakerOnly?: boolean;
  /** Visible only to sponsor-page owners/managers. */
  sponsorOnly?: boolean;
  /** Full-page navigation (plain anchor) — e.g. the TSLS crossover, which is
      a redirecting route handler, not a client-routable page. */
  external?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Mirrors the sidebar in mockup/momentum-plus-v5.html. Routes follow SPEC.md §5.
// Four groups (Matt, 2026-07-20): Learn / Connect / Partners & More /
// My Profile — a flat wall of equal-weight tabs made nothing stand out.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Learn",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
      { label: "Sessions", href: "/sessions", icon: SessionsIcon },
      { label: "Rooted Focus", href: "/rooted-focus", icon: TargetIcon },
      { label: "Calendar", href: "/calendar", icon: CalendarIcon },
      { label: "Library", href: "/library", icon: LibraryIcon },
      { label: "Education", href: "/education", icon: EducationIcon },
      // Unreleased — hidden from members (admins can preview) so a first-run
      // explore doesn't dead-end on a "Coming soon" teaser. Flip adminOnly
      // off when the program ships.
      {
        label: "Aspire2Achieve Growth",
        href: "/aspire2achieve",
        icon: StarIcon,
        adminOnly: true,
      },
    ],
  },
  {
    label: "Connect",
    items: [
      { label: "Community", href: "/community", icon: CommunityIcon },
      { label: "Members", href: "/members", icon: UsersIcon },
      { label: "Speakers", href: "/speakers", icon: SpeakersIcon },
      // Placeholder while the networking-group integration is worked out —
      // admins only until it's real.
      {
        label: "Networking",
        href: "/networking",
        icon: UsersIcon,
        adminOnly: true,
      },
    ],
  },
  {
    label: "Partners & More",
    items: [
      { label: "Sponsors", href: "/sponsors", icon: SponsorsIcon },
      { label: "Resources", href: "/resources", icon: ResourcesIcon },
      {
        label: "Additional Services",
        href: "/services",
        icon: BriefcaseIcon,
      },
      // One-click crossover into the Tri-State Summit event app. Only shows
      // once NEXT_PUBLIC_TSLS_EVENT_URL is set (i.e. during event season).
      ...(process.env.NEXT_PUBLIC_TSLS_EVENT_URL
        ? [
            {
              label: "Summit Event App",
              href: "/go/tsls",
              icon: CalendarIcon,
              external: true,
            } as NavItem,
          ]
        : []),
    ],
  },
  {
    label: "My Profile",
    items: [
      { label: "My Profile", href: "/profile", icon: ProfileIcon },
      {
        label: "Speaker Studio",
        href: "/speaker",
        icon: SpeakersIcon,
        speakerOnly: true,
      },
      {
        label: "Sponsor Studio",
        href: "/sponsor",
        icon: SponsorsIcon,
        sponsorOnly: true,
      },
      {
        label: "Admin Panel",
        href: "/admin",
        icon: AdminIcon,
        adminOnly: true,
      },
    ],
  },
];

// Map a pathname to the topbar title.
export function titleForPath(pathname: string): string {
  // Not in the sidebar — reached from the avatar menu and upsell links.
  if (pathname === "/upgrade" || pathname.startsWith("/upgrade/")) {
    return "Plans & Upgrades";
  }
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (match) return match.label === "My Profile" ? "My Profile" : match.label;
  return "Momentum+";
}
