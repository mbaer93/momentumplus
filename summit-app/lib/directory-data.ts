/*
 * Phase 6 placeholder data: speakers, resources, sponsors. Content mirrors
 * mockup/momentum-plus-v5.html. Real rows come from the speakers/resources/
 * sponsors tables when Supabase is configured (queries fall back to these).
 */

export interface SpeakerProfile {
  id: string;
  name: string;
  title: string;
  initials: string;
  avatarBg: string;
  avatarColor: string;
  bannerGradient: string;
  industries: string[];
  bio: string;
  memberSince: string;
  sessionCount: number;
  sessionSlugs: string[];
  headshotUrl: string | null;
  website: string | null;
}

export const speakers: SpeakerProfile[] = [
  {
    id: "holly",
    name: "Holly Bertone, PMP",
    title: "Peak Performance Coach & Former Intelligence Officer",
    initials: "HB",
    avatarBg: "#1C3050",
    avatarColor: "#D4AE75",
    bannerGradient: "linear-gradient(135deg,#0B1622,#1C3050)",
    industries: ["Leadership", "Resilience", "Performance", "Mindset"],
    bio: "Holly Bertone is a peak performance coach who spent two decades leading high-stakes teams as an intelligence officer before turning her frameworks toward business leaders. Her work focuses on resilience systems — the daily and weekly rituals that let high-achievers sustain output without burning out.",
    memberSince: "Mar 2024",
    sessionCount: 6,
    sessionSlugs: ["resilience-rituals", "leading-intention"],
    headshotUrl: null,
    website: null,
  },
  {
    id: "rob",
    name: "Rob Wentz",
    title: "Executive Leadership Coach & Organizational Psychologist",
    initials: "RW",
    avatarBg: "#3A6B96",
    avatarColor: "#fff",
    bannerGradient: "linear-gradient(135deg,#0B1622,#3A6B96)",
    industries: ["Strategy", "Teams", "Change Mgmt", "Culture"],
    bio: "Rob Wentz pairs organizational psychology with two decades of executive coaching. He helps leaders design the systems — operating rhythms, decision rights, trust architecture — that make teams perform without heroics.",
    memberSince: "Jan 2024",
    sessionCount: 8,
    sessionSlugs: ["high-perf-teams", "strategic-goal"],
    headshotUrl: null,
    website: null,
  },
  {
    id: "allison",
    name: "Allison Trobaugh",
    title: "Integrative Health Coach & Workplace Wellness Expert",
    initials: "AT",
    avatarBg: "#3A7055",
    avatarColor: "#fff",
    bannerGradient: "linear-gradient(135deg,#0B1622,#3A7055)",
    industries: ["Wellness", "Mindfulness", "Energy"],
    bio: "Allison Trobaugh helps leaders treat energy as a designed system, not an accident. Her integrative approach connects nutrition, recovery, and focus practices to measurable leadership performance.",
    memberSince: "Feb 2024",
    sessionCount: 5,
    sessionSlugs: [],
    headshotUrl: null,
    website: null,
  },
  {
    id: "lisa",
    name: "Lisa Herndon",
    title: "Strategic Communications & Executive Presence Coach",
    initials: "LH",
    avatarBg: "#5C3D7A",
    avatarColor: "#fff",
    bannerGradient: "linear-gradient(135deg,#0B1622,#5C3D7A)",
    industries: ["Communication", "Presence", "Influence"],
    bio: "Lisa Herndon coaches executives who have the substance but hesitate in the spotlight. Her three-point messaging system and presence work have shaped leaders across the Tri-State's boardrooms and stages.",
    memberSince: "Apr 2024",
    sessionCount: 4,
    sessionSlugs: ["strategic-networking"],
    headshotUrl: null,
    website: null,
  },
  {
    id: "katie",
    name: "Katie Nelson",
    title: "Business Growth Strategist & Entrepreneur Coach",
    initials: "KN",
    avatarBg: "#A04040",
    avatarColor: "#fff",
    bannerGradient: "linear-gradient(135deg,#0B1622,#A04040)",
    industries: ["Business", "Revenue", "Scale"],
    bio: "Katie Nelson has guided hundreds of founders from scrappy revenue to structured scale. Her revenue architecture method covers pricing, positioning, and the growth systems that let a business run beyond its founder.",
    memberSince: "Jan 2024",
    sessionCount: 7,
    sessionSlugs: ["mastermind-q3"],
    headshotUrl: null,
    website: null,
  },
];

export interface ResourceItem {
  id: string;
  type: string;
  typeColor: string;
  iconBg: string;
  title: string;
  description: string;
  tags: string[];
  actionLabel: string;
  url: string;
  imageUrl: string | null;
  minAccess: "all_members" | "vip_plus" | "pro_only";
}

export const resources: ResourceItem[] = [
  {
    id: "north-star-workbook",
    type: "PDF Worksheet",
    typeColor: "var(--gold)",
    iconBg: "var(--gold-pale)",
    title: "Leadership North Star Workbook",
    description:
      "Define your personal leadership philosophy and build a 30-day alignment plan.",
    tags: ["Leadership", "Holly Bertone"],
    actionLabel: "Download",
    url: "#",
    imageUrl: null,
    minAccess: "all_members",
  },
  {
    id: "okr-template",
    type: "Google Sheet",
    typeColor: "var(--accent-blue)",
    iconBg: "rgba(58,107,150,0.1)",
    title: "OKR Goal Architecture Template",
    description:
      "Rob Wentz's proprietary OKR template for leaders and teams — with 90-day review cadence.",
    tags: ["Business", "Rob Wentz"],
    actionLabel: "Open",
    url: "#",
    imageUrl: null,
    minAccess: "all_members",
  },
  {
    id: "presence-playbook",
    type: "eBook — Members Only",
    typeColor: "var(--purple)",
    iconBg: "rgba(92,61,122,0.1)",
    title: "The Executive Presence Playbook",
    description:
      "47 pages covering body language mastery, vocal authority, and Lisa's three-point messaging system.",
    tags: ["Communication", "Lisa Herndon"],
    actionLabel: "Download",
    url: "#",
    imageUrl: null,
    minAccess: "vip_plus",
  },
  {
    id: "team-health",
    type: "PDF Tool",
    typeColor: "var(--accent-green)",
    iconBg: "rgba(58,112,85,0.1)",
    title: "Hybrid Team Health Assessment",
    description:
      "Diagnose your team's collaboration gaps and get an action protocol for hybrid work environments.",
    tags: ["Leadership", "Rob Wentz"],
    actionLabel: "Download",
    url: "#",
    imageUrl: null,
    minAccess: "all_members",
  },
  {
    id: "revenue-workbook",
    type: "Workbook — Members Only",
    typeColor: "var(--accent-red)",
    iconBg: "rgba(160,64,64,0.1)",
    title: "Revenue Architecture Workbook",
    description:
      "Katie's 60-page workbook including pricing matrices, positioning worksheets, and growth tracking.",
    tags: ["Business", "Katie Nelson"],
    actionLabel: "Download",
    url: "#",
    imageUrl: null,
    minAccess: "vip_plus",
  },
  {
    id: "ritual-planner",
    type: "PDF Planner",
    typeColor: "var(--gold)",
    iconBg: "rgba(184,150,90,0.1)",
    title: "Resilience Ritual Planner",
    description:
      "Build your personalized Resilience Ritual Stack with Holly's evidence-based micro-ritual framework.",
    tags: ["Wellness", "Holly Bertone"],
    actionLabel: "Download",
    url: "#",
    imageUrl: null,
    minAccess: "all_members",
  },
];

import type { SponsorTier } from "@/lib/sponsor-tiers";

export interface SponsorItem {
  id: string;
  name: string;
  tier: SponsorTier;
  tagline: string;
  /** Long-form "about" text shown on the sponsor's profile page. */
  description: string;
  offer: string | null;
  website: string;
  /** Mockup wordmark stand-in — preview placeholders only; null for real rows. */
  wordmark: "newstalk" | "bank" | "summit" | "clarity" | "wellness" | "photo" | null;
  logoUrl: string | null;
  /** Uploaded ad creative shown in the right-hand sponsor rail (distinct from the logo). */
  sidebarAdUrl: string | null;
  railActive: boolean;
}

export const sponsors: SponsorItem[] = [
  {
    id: "newstalk",
    name: "NewsTalk 103.7 FM",
    tier: "momentum_plus",
    tagline: "The Tri-State's voice for local news, talk, and community.",
    description: "",
    offer: null,
    website: "https://example.com",
    wordmark: "newstalk",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: true,
  },
  {
    id: "cv-bank",
    name: "Cumberland Valley Bank",
    tier: "gold",
    tagline: "Community banking for the businesses that build the Tri-State.",
    description: "",
    offer: "Complimentary business banking review for Momentum+ members.",
    website: "https://example.com",
    wordmark: "bank",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: true,
  },
  {
    id: "summit-growth",
    name: "Summit Growth Partners",
    tier: "gold",
    tagline: "Fractional CFO and growth advisory for scaling companies.",
    description: "",
    offer: "Free 60-minute growth diagnostic for members.",
    website: "https://example.com",
    wordmark: "summit",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: true,
  },
  {
    id: "clarity-hr",
    name: "Clarity HR Solutions",
    tier: "partner",
    tagline: "People operations, handled — from handbook to hiring.",
    description: "",
    offer: "15% off the first engagement for Momentum+ members.",
    website: "https://example.com",
    wordmark: "clarity",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: false,
  },
  {
    id: "peak-wellness",
    name: "Peak Wellness Collective",
    tier: "partner",
    tagline: "Corporate wellness programs rooted in real behavior change.",
    description: "",
    offer: null,
    website: "https://example.com",
    wordmark: "wellness",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: false,
  },
  {
    id: "demple-photo",
    name: "Demple Photography",
    tier: "partner",
    tagline: "Executive portraits and event photography across MD, PA & WV.",
    description: "",
    offer: "Member headshot sessions at summit rates.",
    website: "https://example.com",
    wordmark: "photo",
    logoUrl: null,
    sidebarAdUrl: null,
    railActive: false,
  },
];
