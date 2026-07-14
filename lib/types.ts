// Domain types mirroring the Supabase schema (SPEC.md §3) and access model (§2).

export type Tier =
  | "tsls_attendee"
  | "tsls_vip"
  | "sub_3mo"
  | "sub_6mo"
  | "sub_monthly"
  | "sub_annual"
  | "speaker"
  | "admin";

export type MembershipStatus = "active" | "past_due" | "canceled" | "expired";

export type MembershipSource = "ghl" | "tsls_import" | "admin";

// Content gating levels used by sessions / resources / videos (SPEC.md §2).
export type AccessLevel = "all_members" | "vip_plus" | "admin_only";

export type SessionStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "completed"
  | "archived";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  industry: string | null;
  company: string | null;
  title: string | null;
  links: Record<string, string>;
  created_at: string;
}

export interface Membership {
  id: string;
  profile_id: string;
  tier: Tier;
  status: MembershipStatus;
  access_starts_at: string | null;
  access_expires_at: string | null;
  ghl_contact_id: string | null;
  source: MembershipSource;
  created_at: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  speakerName: string;
  startsAt: string; // ISO
  durationMin: number;
  status: SessionStatus;
}

export type SessionCategory =
  | "Leadership"
  | "Wellness"
  | "Business"
  | "Networking";

export interface SessionSpeaker {
  id: string;
  name: string;
  title: string;
  initials: string;
  avatarBg: string;
  avatarColor: string;
}

export interface SessionResource {
  id: string;
  name: string;
  type: string; // e.g. "PDF · 12 pages"
  url: string;
}

export interface AiSummary {
  takeaways: string[];
  quotes: string[];
  actionItems: string[];
  highlights: string | null;
  model: string | null;
  generatedAt: string | null;
}

// Full session as consumed by the UI (joined with speaker/resources/enrollment).
export interface SessionDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: SessionCategory;
  objectives: string[];
  speaker: SessionSpeaker;
  startsAt: string; // ISO
  durationMin: number;
  capacity: number | null;
  enrolledCount: number;
  minAccess: AccessLevel;
  status: SessionStatus;
  zoomJoinUrl: string | null;
  zoomMeetingId: string | null;
  resources: SessionResource[];
  aiSummary: AiSummary | null;
  // Per-viewer state
  isEnrolled: boolean;
  attended: boolean;
  note: string;
}

export interface CommunityActivity {
  id: string;
  actorInitials: string;
  actorName: string;
  avatarBg: string;
  avatarColor: string;
  text: string;
  channel: string;
  time: string;
}

export interface DashboardStats {
  upcomingSessions: number;
  sessionsAttended: number;
  newMessages: number;
  memberSinceDays: number;
}
