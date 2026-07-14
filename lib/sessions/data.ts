import type {
  SessionCategory,
  SessionDetail,
  SessionSpeaker,
} from "@/lib/types";

/*
 * Placeholder sessions for Phase 2 preview mode (no live Supabase). Real
 * queries live in lib/sessions/queries.ts and take over when Supabase is
 * configured. Content mirrors mockup/momentum-plus-v5.html.
 *
 * Times are computed relative to "now" so the UI can exercise every state:
 * a session that is live right now, upcoming ones (one inside the 30-min join
 * window), and completed ones with an AI summary.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const speakers: Record<string, SessionSpeaker> = {
  holly: {
    id: "holly",
    name: "Holly Bertone, PMP",
    title: "Speaker · Leadership & Resilience",
    initials: "HB",
    avatarBg: "#1C3050",
    avatarColor: "#D4AE75",
  },
  lisa: {
    id: "lisa",
    name: "Lisa Herndon & Katie Nelson",
    title: "Networking Strategists",
    initials: "LH",
    avatarBg: "#5C3D7A",
    avatarColor: "#ffffff",
  },
  katie: {
    id: "katie",
    name: "Katie Nelson",
    title: "Mastermind Facilitator",
    initials: "KN",
    avatarBg: "#3A6B96",
    avatarColor: "#ffffff",
  },
  rob: {
    id: "rob",
    name: "Rob Wentz",
    title: "Operations & Strategy",
    initials: "RW",
    avatarBg: "#3A6B96",
    avatarColor: "#ffffff",
  },
  allison: {
    id: "allison",
    name: "Allison Trobaugh",
    title: "Operations Leader · Guest Speaker",
    initials: "AT",
    avatarBg: "#3A7055",
    avatarColor: "#ffffff",
  },
};

interface Seed {
  slug: string;
  title: string;
  description: string;
  category: SessionCategory;
  objectives: string[];
  speaker: SessionSpeaker;
  offsetMs: number; // start relative to now
  durationMin: number;
  enrolledCount: number;
  minAccess: SessionDetail["minAccess"];
  isEnrolled: boolean;
  resources: SessionDetail["resources"];
  withSummary?: boolean;
}

const seeds: Seed[] = [
  {
    slug: "high-perf-teams",
    title: "Building High-Performance Teams in Hybrid Environments",
    description:
      "A practical working session on the habits, rituals, and communication systems that keep hybrid teams aligned and accountable — without micromanaging.",
    category: "Leadership",
    objectives: [
      "Design a lightweight weekly operating rhythm for hybrid teams",
      "Set expectations that survive async work",
      "Build trust signals that don't depend on being in the room",
    ],
    speaker: speakers.rob,
    offsetMs: -20 * 60 * 1000, // started 20 min ago → live now
    durationMin: 75,
    enrolledCount: 52,
    minAccess: "all_members",
    isEnrolled: true,
    resources: [
      {
        id: "r1",
        name: "Hybrid Operating Rhythm — worksheet",
        type: "PDF · 4 pages",
        url: "#",
      },
    ],
  },
  {
    slug: "resilience-rituals",
    title: "Resilience Rituals for High-Achievers",
    description:
      "Burnout isn't a badge of honor. Holly shares the daily and weekly rituals high-achievers use to sustain performance without running the tank dry.",
    category: "Wellness",
    objectives: [
      "Build a personal resilience routine you'll actually keep",
      "Recognize the early warning signs of burnout",
      "Protect focus in an always-on environment",
    ],
    speaker: speakers.holly,
    offsetMs: 20 * 60 * 1000, // starts in 20 min → inside 30-min join window
    durationMin: 90,
    enrolledCount: 61,
    minAccess: "all_members",
    isEnrolled: true,
    resources: [
      {
        id: "r2",
        name: "The Resilience Rituals Checklist",
        type: "PDF · 2 pages",
        url: "#",
      },
      {
        id: "r3",
        name: "Morning routine template",
        type: "Google Doc",
        url: "#",
      },
    ],
  },
  {
    slug: "strategic-networking",
    title: "Strategic Networking: Building Your Leadership Ecosystem",
    description:
      "Networking isn't collecting contacts — it's cultivating an ecosystem. Lisa and Katie walk through a repeatable system for building relationships that compound.",
    category: "Networking",
    objectives: [
      "Map your current leadership ecosystem",
      "Create a sustainable follow-up cadence",
      "Give before you ask — the reciprocity engine",
    ],
    speaker: speakers.lisa,
    offsetMs: 7 * DAY,
    durationMin: 90,
    enrolledCount: 67,
    minAccess: "all_members",
    isEnrolled: false,
    resources: [],
  },
  {
    slug: "mastermind-q3",
    title: "Q3 Mastermind Intensive: Mid-Year Reset",
    description:
      "A facilitated half-day intensive to reset your priorities for the back half of the year. VIP and annual members only.",
    category: "Business",
    objectives: [
      "Audit progress against your annual goals",
      "Re-sequence priorities for Q3–Q4",
      "Leave with a 90-day action plan",
    ],
    speaker: speakers.katie,
    offsetMs: 14 * DAY,
    durationMin: 180,
    enrolledCount: 18,
    minAccess: "vip_plus",
    isEnrolled: true,
    resources: [],
  },
  {
    slug: "leading-intention",
    title: "Leading with Intention: Setting Your Leadership North Star",
    description:
      "Every leader drifts without a north star. This session helps you define the principles that make your decisions faster and more consistent.",
    category: "Leadership",
    objectives: [
      "Draft your leadership north star statement",
      "Translate values into day-to-day decisions",
      "Communicate intent so your team can run without you",
    ],
    speaker: speakers.holly,
    offsetMs: -35 * DAY,
    durationMin: 75,
    enrolledCount: 47,
    minAccess: "all_members",
    isEnrolled: true,
    resources: [
      {
        id: "r4",
        name: "North Star worksheet",
        type: "PDF · 3 pages",
        url: "#",
      },
    ],
    withSummary: true,
  },
  {
    slug: "strategic-goal",
    title: "Strategic Goal Setting: The OKR Method for Leaders",
    description:
      "A hands-on introduction to OKRs for leaders who want a goal system that actually drives focus and measurable outcomes.",
    category: "Business",
    objectives: [
      "Write objectives that inspire and key results that measure",
      "Cascade OKRs without turning them into a to-do list",
      "Run a lightweight quarterly review",
    ],
    speaker: speakers.rob,
    offsetMs: -63 * DAY,
    durationMin: 60,
    enrolledCount: 39,
    minAccess: "all_members",
    isEnrolled: true,
    resources: [],
    withSummary: true,
  },
];

function summaryFor(seed: Seed): SessionDetail["aiSummary"] {
  if (!seed.withSummary) return null;
  return {
    takeaways: [
      "Clarity isn't a speech you give once — it's the thing your team feels every week.",
      "Consistency beats intensity: small, repeated signals build durable trust.",
      "Name the one metric that matters this quarter and protect it.",
    ],
    quotes: [
      "Clarity isn't a speech you give once. It's the thing your team feels every week.",
    ],
    actionItems: [
      "Write a one-sentence north star and share it with your team this week.",
      "Pick one weekly ritual to start and one meeting to cut.",
    ],
    highlights:
      "A focused session on turning leadership values into a weekly operating rhythm.",
    model: "claude",
    generatedAt: new Date(Date.now() - 30 * DAY).toISOString(),
  };
}

function statusFor(startsAt: number, durationMin: number): SessionDetail["status"] {
  const now = Date.now();
  const end = startsAt + durationMin * 60 * 1000;
  if (now >= startsAt && now <= end) return "live";
  if (now > end) return "completed";
  return "scheduled";
}

export function getPlaceholderSessions(): SessionDetail[] {
  const now = Date.now();
  return seeds.map((seed) => {
    const startsAtMs = now + seed.offsetMs;
    const status = statusFor(startsAtMs, seed.durationMin);
    return {
      id: seed.slug,
      slug: seed.slug,
      title: seed.title,
      description: seed.description,
      category: seed.category,
      objectives: seed.objectives,
      speaker: seed.speaker,
      startsAt: new Date(startsAtMs).toISOString(),
      durationMin: seed.durationMin,
      capacity: null,
      enrolledCount: seed.enrolledCount,
      minAccess: seed.minAccess,
      status,
      zoomJoinUrl: "https://zoom.us/j/0000000000",
      zoomMeetingId: "0000000000",
      resources: seed.resources,
      aiSummary: summaryFor(seed),
      isEnrolled: seed.isEnrolled,
      attended: status === "completed" && seed.isEnrolled,
      note: "",
    } satisfies SessionDetail;
  });
}

export function getPlaceholderSession(slug: string): SessionDetail | null {
  return getPlaceholderSessions().find((s) => s.slug === slug) ?? null;
}
