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
  /** Key in app_features. The tab still renders when the member's tier isn't
      granted it — with a padlock, leading to /upgrade. Tabs with no feature
      key are ungated plumbing (the Studios, the Admin Panel). */
  feature?: string;
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
      { label: "Sessions", href: "/sessions", icon: SessionsIcon, feature: "sessions" },
      { label: "Rooted Focus", href: "/rooted-focus", icon: TargetIcon, feature: "rooted_focus" },
      { label: "Calendar", href: "/calendar", icon: CalendarIcon, feature: "calendar" },
      { label: "Library", href: "/library", icon: LibraryIcon, feature: "library" },
      { label: "Grow on the Go", href: "/education", icon: EducationIcon, feature: "education" },
      // Unreleased. `is_launched` in the feature registry keeps it to admins
      // now; Control Center → Launch switches is what ships it.
      {
        label: "Aspire2Achieve Growth",
        href: "/aspire2achieve",
        icon: StarIcon,
        feature: "aspire2achieve",
      },
    ],
  },
  {
    label: "Connect",
    items: [
      { label: "Community", href: "/community", icon: CommunityIcon, feature: "community" },
      { label: "Members", href: "/members", icon: UsersIcon, feature: "members" },
      { label: "Speakers", href: "/speakers", icon: SpeakersIcon, feature: "speakers" },
      // Placeholder while the networking-group integration is worked out —
      // unlaunched in the registry until it's real.
      {
        label: "Networking",
        href: "/networking",
        icon: UsersIcon,
        feature: "networking",
      },
    ],
  },
  {
    label: "Partners & More",
    items: [
      { label: "Sponsors", href: "/sponsors", icon: SponsorsIcon, feature: "sponsors" },
      { label: "Resources", href: "/resources", icon: ResourcesIcon, feature: "resources" },
      {
        label: "Additional Services",
        href: "/services",
        icon: BriefcaseIcon,
        feature: "services",
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
  if (pathname === "/search") return "Search";
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (match) return match.label === "My Profile" ? "My Profile" : match.label;
  return "Momentum+";
}
