import type { AccessLevel, AiSummary } from "@/lib/types";

/*
 * Video library data. Placeholder set mirrors mockup/momentum-plus-v5.html;
 * real rows come from the videos table when Supabase + Mux are configured.
 */

export interface VideoItem {
  id: string;
  title: string;
  category: "Leadership" | "Wellness" | "Business";
  speakerName: string;
  durationLabel: string;
  dateLabel: string;
  gradient: string;
  minAccess: AccessLevel;
  muxPlaybackId: string | null;
  /** Card image: uploaded thumbnail, else the Mux screen grab. */
  thumbnailUrl?: string | null;
  sessionId: string | null;
  aiSummary: AiSummary | null;
  /** True for a teaser the viewer can't watch — shown as a locked upsell
      card (metadata only; no playback id ever reaches the browser). */
  locked?: boolean;
}

const summary = (highlights: string, takeaways: string[]): AiSummary => ({
  takeaways,
  quotes: [],
  actionItems: [],
  highlights,
  model: "claude",
  generatedAt: "2026-06-01T00:00:00.000Z",
});

export const placeholderVideos: VideoItem[] = [
  {
    id: "burnout-blueprint",
    title: "The Burnout Blueprint: A Framework for Sustainable High Performance",
    category: "Wellness",
    speakerName: "Holly Bertone, PMP",
    durationLabel: "52 min",
    dateLabel: "Aug 2025",
    gradient: "linear-gradient(135deg,#1C3050,#3A6B96)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: summary(
      "A practical framework for sustaining high performance without burning out.",
      [
        "Burnout is a systems problem, not a willpower problem.",
        "Schedule recovery like you schedule meetings.",
        "Audit your energy drains quarterly.",
      ],
    ),
  },
  {
    id: "trust-architecture",
    title: "The Trust Architecture: Building Unshakeable Team Foundations",
    category: "Leadership",
    speakerName: "Rob Wentz",
    durationLabel: "61 min",
    dateLabel: "Sep 2025",
    gradient: "linear-gradient(135deg,#3A6B96,#5C3D7A)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: summary(
      "How trust is engineered — not hoped for — inside high-performing teams.",
      [
        "Trust compounds through small kept promises.",
        "Clarity is a trust signal: vague leaders read as unreliable.",
      ],
    ),
  },
  {
    id: "vitality-blueprint",
    title: "The Vitality Blueprint: Energy Architecture for High Performers",
    category: "Wellness",
    speakerName: "Allison Trobaugh",
    durationLabel: "47 min",
    dateLabel: "Oct 2025",
    gradient: "linear-gradient(135deg,#3A7055,#B8965A)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
  {
    id: "command-the-room",
    title: "Command the Room: Executive Presence for Leaders Who Hesitate",
    category: "Leadership",
    speakerName: "Lisa Herndon",
    durationLabel: "58 min",
    dateLabel: "Nov 2025",
    gradient: "linear-gradient(135deg,#5C3D7A,#3A6B96)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
  {
    id: "revenue-architecture",
    title: "The Revenue Architecture: Designing a Business That Scales",
    category: "Business",
    speakerName: "Katie Nelson",
    durationLabel: "63 min",
    dateLabel: "Dec 2025",
    gradient: "linear-gradient(135deg,#A04040,#5C3D7A)",
    minAccess: "vip_plus",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
  {
    id: "leadership-fuel",
    title: "Food as Leadership Fuel: The Nutritional Edge High Performers Use",
    category: "Wellness",
    speakerName: "Allison Trobaugh",
    durationLabel: "44 min",
    dateLabel: "Aug 2025",
    gradient: "linear-gradient(135deg,#3A7055,#1C3050)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
  {
    id: "culture-by-design",
    title: "Culture by Design: Intentional Team Culture-Building Frameworks",
    category: "Leadership",
    speakerName: "Rob Wentz",
    durationLabel: "55 min",
    dateLabel: "Jul 2025",
    gradient: "linear-gradient(135deg,#0B1622,#3A6B96)",
    minAccess: "all_members",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
  {
    id: "pricing-premium",
    title: "Pricing for Premium: How to Charge What You're Worth",
    category: "Business",
    speakerName: "Katie Nelson",
    durationLabel: "49 min",
    dateLabel: "Oct 2025",
    gradient: "linear-gradient(135deg,#1C3050,#A04040)",
    minAccess: "vip_plus",
    muxPlaybackId: null,
    sessionId: null,
    aiSummary: null,
  },
];

const GRADIENTS = [
  "linear-gradient(135deg,#1C3050,#3A6B96)",
  "linear-gradient(135deg,#3A6B96,#5C3D7A)",
  "linear-gradient(135deg,#3A7055,#B8965A)",
  "linear-gradient(135deg,#5C3D7A,#3A6B96)",
  "linear-gradient(135deg,#A04040,#5C3D7A)",
  "linear-gradient(135deg,#3A7055,#1C3050)",
];

/** Deterministic gradient for real videos without artwork. */
export function gradientFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}
