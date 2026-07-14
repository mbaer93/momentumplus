/*
 * Placeholder community content for preview mode (no Stream credentials).
 * Content mirrors mockup/momentum-plus-v5.html so the design reference holds.
 */

export interface ChatMessage {
  id: string;
  authorName: string;
  authorInitials: string;
  avatarBg: string;
  avatarColor: string;
  isYou?: boolean;
  timeLabel: string;
  paragraphs: string[];
  reactions: { color: string; count: number }[];
}

export const placeholderMessages: Record<string, ChatMessage[]> = {
  general: [
    {
      id: "g1",
      authorName: "Holly Bertone",
      authorInitials: "HB",
      avatarBg: "#1C3050",
      avatarColor: "#D4AE75",
      timeLabel: "Today at 9:14 AM",
      paragraphs: [
        "Good morning, Momentum family! Quick reminder that our Resilience Rituals session is coming up on Feb 18th. I've been getting some incredible pre-session questions from you all — keep them coming! Drop your biggest resilience challenge below and I'll address them live.",
        "Also, I just shared the pre-session prep worksheet in the resources channel. Make sure you complete pages 1-3 before we meet — it'll make the live session about 3x more impactful.",
      ],
      reactions: [
        { color: "var(--accent-red)", count: 24 },
        { color: "var(--gold)", count: 18 },
        { color: "#A04040", count: 12 },
      ],
    },
    {
      id: "g2",
      authorName: "Allison Trobaugh",
      authorInitials: "AT",
      avatarBg: "#3A7055",
      avatarColor: "#fff",
      timeLabel: "Today at 9:31 AM",
      paragraphs: [
        "Holly!! So excited for this one. I'm going to be sharing it with my whole team. Quick question for the group: how many of you have a consistent morning ritual vs. flying by the seat of your pants each day?",
        'No judgment — I was firmly in the "chaos is my ritual" camp until two years ago. The shift was life-changing. Drop a comment if you\'re still figuring it out!',
      ],
      reactions: [
        { color: "var(--accent-blue)", count: 31 },
        { color: "var(--mid-gray)", count: 14 },
      ],
    },
    {
      id: "g3",
      authorName: "Sarah Johnson",
      authorInitials: "SJ",
      avatarBg: "linear-gradient(135deg,var(--gold),var(--gold-light))",
      avatarColor: "var(--navy)",
      isYou: true,
      timeLabel: "Today at 9:45 AM",
      paragraphs: [
        "Allison! Firmly in the chaos camp here. My mornings are reactive from the moment I wake up — checking email before I'm even out of bed. Holly's session couldn't come at a better time. My biggest challenge is that I know WHAT to do, I just can't seem to make it stick past day 3.",
      ],
      reactions: [
        { color: "var(--accent-blue)", count: 22 },
        { color: "var(--accent-green)", count: 9 },
      ],
    },
    {
      id: "g4",
      authorName: "Rob Wentz",
      authorInitials: "RW",
      avatarBg: "#3A6B96",
      avatarColor: "#fff",
      timeLabel: "Today at 10:02 AM",
      paragraphs: [
        'Sarah, that "day 3 drop-off" is one of the most researched phenomena in behavioral psychology. The research is clear: the problem isn\'t willpower — it\'s system design. You\'re trying to bolt new behaviors onto an existing system that wasn\'t built to support them.',
        "Holly and I actually co-authored a piece on this for the member resources library. The short version: your environment does 80% of the work. The remaining 20% is identity-level commitment. Will be touching on this in my March session too!",
      ],
      reactions: [
        { color: "var(--gold)", count: 38 },
        { color: "var(--purple)", count: 17 },
        { color: "var(--gold)", count: 11 },
      ],
    },
  ],
  announcements: [
    {
      id: "a1",
      authorName: "Momentum+ Team",
      authorInitials: "M+",
      avatarBg: "#1C3050",
      avatarColor: "#D4AE75",
      timeLabel: "Yesterday at 4:00 PM",
      paragraphs: [
        "Welcome to the Momentum+ community! Introduce yourself in #networking, browse the upcoming sessions, and make this space your own. This channel is for official updates only — watch here for new sessions, recordings, and member perks.",
      ],
      reactions: [{ color: "var(--gold)", count: 42 }],
    },
  ],
};

export const onlineMembers = [
  { name: "Holly Bertone", online: true },
  { name: "Allison Trobaugh", online: true },
  { name: "Marcus Chen", online: true },
  { name: "Priya Nair", online: true },
  { name: "Derek Williams", online: true },
  { name: "Rob Wentz", online: false },
  { name: "Lisa Herndon", online: false },
  { name: "Katie Nelson", online: false },
];

export const pinnedMessage = {
  title: "Community Guidelines",
  body: "Be generous, be real, be kind. This space thrives on authentic sharing and mutual support.",
};

export const directMessages = [
  { name: "Holly Bertone", online: true },
  { name: "Rob Wentz", online: false },
  { name: "Allison Trobaugh", online: true },
];
