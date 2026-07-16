/*
 * Admin activity log: one chronological feed assembled from the events the
 * system already records — no separate tracking table to drift out of sync.
 * Service-role reads; admin-only pages consume this.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type ActivityKind =
  | "invite_sent"
  | "first_login"
  | "signed_in"
  | "membership"
  | "enrolled"
  | "lesson_completed"
  | "video_watched"
  | "resource_opened"
  | "sponsor_click"
  | "announcement";

export interface ActivityEvent {
  at: string; // ISO
  kind: ActivityKind;
  /** Short human label for the kind ("Invite sent"). */
  kindLabel: string;
  memberName: string; // "" for system events
  memberEmail: string;
  detail: string;
}

export const KIND_LABELS: Record<ActivityKind, string> = {
  invite_sent: "Invite sent",
  first_login: "First login",
  signed_in: "Signed in",
  membership: "Membership",
  enrolled: "Session enrollment",
  lesson_completed: "Lesson completed",
  video_watched: "Watched recording",
  resource_opened: "Opened resource",
  sponsor_click: "Sponsor click",
  announcement: "Announcement",
};

const PER_SOURCE_LIMIT = 150;
const FEED_LIMIT = 250;

const PREVIEW_EVENTS: ActivityEvent[] = [
  {
    at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    kind: "signed_in",
    kindLabel: KIND_LABELS.signed_in,
    memberName: "Sarah Johnson",
    memberEmail: "sarah@example.com",
    detail: "",
  },
  {
    at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    kind: "lesson_completed",
    kindLabel: KIND_LABELS.lesson_completed,
    memberName: "Priya Nair",
    memberEmail: "priya@example.com",
    detail: "Leading Through Change — Lesson 3",
  },
  {
    at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    kind: "invite_sent",
    kindLabel: KIND_LABELS.invite_sent,
    memberName: "Marcus Chen",
    memberEmail: "marcus@example.com",
    detail: "VIP Member",
  },
];

interface ProfileRef {
  full_name: string | null;
  email: string | null;
}

function memberOf(p: ProfileRef | null | undefined): {
  memberName: string;
  memberEmail: string;
} {
  return {
    memberName: p?.full_name || p?.email || "Member",
    memberEmail: p?.email ?? "",
  };
}

export async function listActivity(): Promise<ActivityEvent[]> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return PREVIEW_EVENTS;
  }
  const admin = createServiceClient();
  const events: ActivityEvent[] = [];

  const [
    authUsers,
    { data: memberships },
    { data: enrollments },
    { data: lessons },
    { data: views },
    { data: resources },
    { data: clicks },
    { data: announcements },
  ] = await Promise.all([
    // Auth layer: invites, invite acceptance (first login), latest sign-in.
    (async () => {
      const users: {
        id: string;
        email?: string | null;
        invited_at?: string | null;
        email_confirmed_at?: string | null;
        confirmed_at?: string | null;
        last_sign_in_at?: string | null;
      }[] = [];
      for (let page = 1; page <= 5; page++) {
        const { data, error } = await admin.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error || !data?.users?.length) break;
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      return users;
    })(),
    admin
      .from("memberships")
      .select("created_at, tier, source, profiles ( full_name, email )")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("enrollments")
      .select(
        "created_at, attended, profiles ( full_name, email ), sessions ( title )",
      )
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("lesson_progress")
      .select(
        "completed_at, profiles ( full_name, email ), course_lessons ( title, courses ( title ) )",
      )
      .order("completed_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("video_views")
      .select("watched_at, profiles ( full_name, email ), videos ( title )")
      .order("watched_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("resource_uses")
      .select("used_at, profiles ( full_name, email ), resources ( title )")
      .order("used_at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("sponsor_events")
      .select("at, kind, profiles ( full_name, email ), sponsors ( name )")
      .eq("kind", "click")
      .order("at", { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    admin
      .from("announcements")
      .select("sent_at, title")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  // Profile names for auth users come from profiles in one lookup.
  const authIds = authUsers.map((u) => u.id);
  const profileById = new Map<string, ProfileRef>();
  if (authIds.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authIds.slice(0, 1000));
    for (const p of profs ?? []) {
      profileById.set(p.id as string, {
        full_name: p.full_name as string | null,
        email: p.email as string | null,
      });
    }
  }

  for (const u of authUsers) {
    const who = memberOf(
      profileById.get(u.id) ?? { full_name: null, email: u.email ?? null },
    );
    if (u.invited_at) {
      events.push({
        at: u.invited_at,
        kind: "invite_sent",
        kindLabel: KIND_LABELS.invite_sent,
        ...who,
        detail: "",
      });
    }
    const confirmed = u.email_confirmed_at ?? u.confirmed_at;
    if (confirmed) {
      events.push({
        at: confirmed,
        kind: "first_login",
        kindLabel: KIND_LABELS.first_login,
        ...who,
        detail: u.invited_at ? "Accepted their invite" : "",
      });
    }
    // Only the most recent sign-in is stored, so this reads as "last seen".
    if (u.last_sign_in_at && u.last_sign_in_at !== confirmed) {
      events.push({
        at: u.last_sign_in_at,
        kind: "signed_in",
        kindLabel: KIND_LABELS.signed_in,
        ...who,
        detail: "Most recent sign-in",
      });
    }
  }

  type Joined<T> = T & { profiles: ProfileRef | null };
  for (const m of (memberships ?? []) as unknown as Joined<{
    created_at: string;
    tier: string;
    source: string;
  }>[]) {
    events.push({
      at: m.created_at,
      kind: "membership",
      kindLabel: KIND_LABELS.membership,
      ...memberOf(m.profiles),
      detail: `${m.tier} (${m.source})`,
    });
  }

  for (const e of (enrollments ?? []) as unknown as Joined<{
    created_at: string;
    attended: boolean;
    sessions: { title: string } | null;
  }>[]) {
    events.push({
      at: e.created_at,
      kind: "enrolled",
      kindLabel: KIND_LABELS.enrolled,
      ...memberOf(e.profiles),
      detail: `${e.sessions?.title ?? "Session"}${e.attended ? " — attended" : ""}`,
    });
  }

  for (const l of (lessons ?? []) as unknown as Joined<{
    completed_at: string | null;
    course_lessons: { title: string; courses: { title: string } | null } | null;
  }>[]) {
    if (!l.completed_at) continue;
    const course = l.course_lessons?.courses?.title;
    events.push({
      at: l.completed_at,
      kind: "lesson_completed",
      kindLabel: KIND_LABELS.lesson_completed,
      ...memberOf(l.profiles),
      detail: [course, l.course_lessons?.title].filter(Boolean).join(" — "),
    });
  }

  for (const v of (views ?? []) as unknown as Joined<{
    watched_at: string;
    videos: { title: string } | null;
  }>[]) {
    events.push({
      at: v.watched_at,
      kind: "video_watched",
      kindLabel: KIND_LABELS.video_watched,
      ...memberOf(v.profiles),
      detail: v.videos?.title ?? "",
    });
  }

  for (const r of (resources ?? []) as unknown as Joined<{
    used_at: string;
    resources: { title: string } | null;
  }>[]) {
    events.push({
      at: r.used_at,
      kind: "resource_opened",
      kindLabel: KIND_LABELS.resource_opened,
      ...memberOf(r.profiles),
      detail: r.resources?.title ?? "",
    });
  }

  for (const c of (clicks ?? []) as unknown as Joined<{
    at: string;
    sponsors: { name: string } | null;
  }>[]) {
    events.push({
      at: c.at,
      kind: "sponsor_click",
      kindLabel: KIND_LABELS.sponsor_click,
      ...memberOf(c.profiles),
      detail: c.sponsors?.name ?? "",
    });
  }

  for (const a of (announcements ?? []) as {
    sent_at: string;
    title: string;
  }[]) {
    events.push({
      at: a.sent_at,
      kind: "announcement",
      kindLabel: KIND_LABELS.announcement,
      memberName: "",
      memberEmail: "",
      detail: a.title,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  return events.slice(0, FEED_LIMIT);
}
