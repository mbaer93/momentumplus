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
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Mirrors the sidebar in mockup/momentum-plus-v5.html. Routes follow SPEC.md §5.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
      { label: "Community", href: "/community", icon: CommunityIcon },
      { label: "Sessions", href: "/sessions", icon: SessionsIcon },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Rooted Focus", href: "/rooted-focus", icon: TargetIcon },
      { label: "Library", href: "/library", icon: LibraryIcon },
      { label: "Education", href: "/education", icon: EducationIcon },
      {
        label: "Aspire2Achieve Full Focus",
        href: "/aspire2achieve",
        icon: StarIcon,
      },
    ],
  },
  {
    label: "Explore",
    items: [
      { label: "Speakers", href: "/speakers", icon: SpeakersIcon },
      { label: "Resources", href: "/resources", icon: ResourcesIcon },
      { label: "Sponsors", href: "/sponsors", icon: SponsorsIcon },
      {
        label: "Additional Services",
        href: "/services",
        icon: BriefcaseIcon,
      },
      // Placeholder while the networking-group integration is worked out —
      // admins only until it's real.
      {
        label: "Networking",
        href: "/networking",
        icon: UsersIcon,
        adminOnly: true,
      },
      { label: "Calendar", href: "/calendar", icon: CalendarIcon },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "My Profile", href: "/profile", icon: ProfileIcon },
      {
        label: "Speaker Studio",
        href: "/speaker",
        icon: SpeakersIcon,
        speakerOnly: true,
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
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (match) return match.label === "My Profile" ? "My Profile" : match.label;
  return "Momentum+";
}
