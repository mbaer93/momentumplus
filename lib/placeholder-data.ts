import type {
  CommunityActivity,
  DashboardStats,
  Profile,
  SessionSummary,
  Tier,
} from "./types";

/*
 * Placeholder data for Phase 1. The backend (Supabase queries) is wired in
 * later phases; until then the dashboard renders from these fixtures so the
 * shell matches mockup/momentum-plus-v5.html. Content taken from the mockup.
 */

export const placeholderProfile: Profile & { tier: Tier } = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Sarah Johnson",
  email: "sarah@example.com",
  phone: null,
  avatar_url: null,
  bio: null,
  industry: "Leadership Development",
  company: "Momentum Advisory",
  title: "Executive Coach",
  links: {},
  created_at: "2024-11-12T00:00:00.000Z",
  tier: "sub_annual",
};

export function initials(fullName: string): string {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const placeholderStats: DashboardStats = {
  upcomingSessions: 3,
  sessionsAttended: 23,
  newMessages: 12,
  memberSinceDays: 487,
};

export const placeholderNextSession = {
  id: "resilience-rituals",
  title: "Resilience Rituals for High-Achievers",
  speakerName: "Holly Bertone, PMP",
  dateLabel: "Feb 18, 2026",
  timeLabel: "11:00 AM EST",
  durationLabel: "90 min",
};

export const placeholderUpcoming: (SessionSummary & {
  month: string;
  day: string;
  timeLabel: string;
})[] = [
  {
    id: "resilience-rituals",
    title: "Resilience Rituals for High-Achievers",
    speakerName: "Holly Bertone, PMP",
    startsAt: "2026-02-18T16:00:00.000Z",
    durationMin: 90,
    status: "scheduled",
    month: "FEB",
    day: "18",
    timeLabel: "11:00 AM",
  },
  {
    id: "strategic-networking",
    title: "Strategic Networking Mastery",
    speakerName: "Lisa Herndon & Katie Nelson",
    startsAt: "2026-02-25T17:00:00.000Z",
    durationMin: 60,
    status: "scheduled",
    month: "FEB",
    day: "25",
    timeLabel: "12:00 PM",
  },
  {
    id: "leading-change",
    title: "Leading Organizational Change",
    speakerName: "Rob Wentz",
    startsAt: "2026-03-11T18:00:00.000Z",
    durationMin: 60,
    status: "scheduled",
    month: "MAR",
    day: "11",
    timeLabel: "2:00 PM",
  },
];

export const placeholderActivity: CommunityActivity[] = [
  {
    id: "1",
    actorInitials: "HB",
    actorName: "Holly Bertone",
    avatarBg: "#1C3050",
    avatarColor: "#D4AE75",
    text: "shared a resource in",
    channel: "general",
    time: "12 min ago",
  },
  {
    id: "2",
    actorInitials: "RW",
    actorName: "Rob Wentz",
    avatarBg: "#3A6B96",
    avatarColor: "#ffffff",
    text: "replied to your comment in",
    channel: "leadership",
    time: "1 hr ago",
  },
  {
    id: "3",
    actorInitials: "AT",
    actorName: "Allison Trobaugh",
    avatarBg: "#3A7055",
    avatarColor: "#ffffff",
    text: "posted in",
    channel: "wellness",
    time: "3 hrs ago",
  },
];
