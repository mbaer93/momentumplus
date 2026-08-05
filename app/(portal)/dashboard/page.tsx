import { Greeting } from "@/components/portal/Greeting";
import { AdSlot } from "@/components/sponsors/AdSlot";
import { BodyAd } from "@/components/sponsors/BodyAd";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import { TestimonialAsk } from "@/components/dashboard/TestimonialAsk";
import { hasTestimonial } from "./testimonial-actions";
import Link from "next/link";
import {
  CalendarIcon,
  ChannelIcon,
  ChevronRightIcon,
  MessageIcon,
  ShieldIcon,
  StarIcon,
  TargetIcon,
} from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import {
  placeholderActivity,
  placeholderNextSession,
  placeholderStats,
  placeholderUpcoming,
} from "@/lib/placeholder-data";
import { listSessions } from "@/lib/sessions/queries";
import { AddToCalendarButton } from "@/components/sessions/AddToCalendarButton";
import { isDropInProgram } from "@/lib/programs";
import { rruleFor } from "@/lib/recurrence";
import {
  dateLabel,
  dayOfMonth,
  displayStatus,
  durationLabel,
  monthShort,
  timeLabel,
} from "@/lib/sessions/view";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getTslsPerks } from "@/lib/tsls-perks";
import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

// The "New Messages" stat costs a Stream API call; at 350 members hitting
// the dashboard it would hammer Stream on every render. A ~2-minute cache
// per member keeps the stat honest enough without the per-render call.
function cachedUnreadTotal(userId: string): Promise<number> {
  return unstable_cache(
    async () => {
      const { getUnreadTotal } = await import("@/lib/stream");
      return getUnreadTotal(userId);
    },
    ["stream-unread-total", userId],
    { revalidate: 120 },
  )();
}

interface UpcomingRow {
  id: string;
  title: string;
  speakerName: string;
  month: string;
  day: string;
  timeLabel: string;
  pill: string;
  pillLabel: string;
}

export default async function DashboardPage() {
  const member = await requireMember();
  const firstName = member.name.split(" ")[0];
  const preview = !isSupabaseConfigured();
  const now = Date.now();

  // --- Assemble dashboard data: real queries when configured, mockup
  // fixtures in preview mode (no credentials) only. --------------------------
  let stats = placeholderStats;
  // "You have N sessions" must mean ENROLLED sessions — the banner used to
  // count the whole catalog, telling members they "have" sessions they never
  // signed up for (and contradicting the enrolled-only bell).
  let enrolledUpcoming = placeholderStats.upcomingSessions;
  let upcoming: UpcomingRow[] = [];
  let nextUp: {
    id: string;
    title: string;
    speakerName: string;
    dateLabel: string;
    timeLabel: string;
    durationLabel: string;
    // Event payload for the Google/Outlook/Apple calendar menu.
    description: string;
    startsAt: string;
    durationMin: number;
    joinUrl: string | null;
    rrule: string | null;
    /** Enrolled members (or drop-in programs) may add to calendar. */
    allowCalendar: boolean;
  } | null = null;
  let memberSinceDays = placeholderStats.memberSinceDays;
  // Getting-started tour signals (server truth; visit-steps live client-side).
  let hasEnrollment = false;
  let prefsSaved = false;

  if (preview) {
    nextUp = { ...placeholderNextSession, allowCalendar: true };
    upcoming = placeholderUpcoming.map((s) => ({
      id: s.id,
      title: s.title,
      speakerName: s.speakerName,
      month: s.month,
      day: s.day,
      timeLabel: s.timeLabel,
      pill: "upcoming",
      pillLabel: "Upcoming",
    }));
  } else {
    const sessions = await listSessions();
    const future = sessions
      .filter(
        (s) =>
          new Date(s.startsAt).getTime() > now &&
          (s.status === "scheduled" || s.status === "live"),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const attended = sessions.filter((s) => s.attended).length;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let newMessages = 0;
    if (user) {
      const [{ data: p }, unread, { count: prefsCount }] = await Promise.all([
        supabase
          .from("profiles")
          .select("created_at")
          .eq("id", user.id)
          .maybeSingle(),
        // Real unread count from Stream — cached ~2 min per member (above).
        cachedUnreadTotal(user.id),
        supabase
          .from("notification_prefs")
          .select("key", { count: "exact", head: true })
          .eq("profile_id", user.id),
      ]);
      newMessages = unread;
      prefsSaved = (prefsCount ?? 0) > 0;
      if (p?.created_at) {
        memberSinceDays = Math.max(
          1,
          Math.floor(
            (now - new Date(p.created_at).getTime()) / (24 * 3600 * 1000),
          ),
        );
      }
    }

    stats = {
      upcomingSessions: future.length,
      sessionsAttended: attended,
      newMessages,
      memberSinceDays,
    };
    enrolledUpcoming = future.filter((s) => s.isEnrolled).length;
    hasEnrollment = sessions.some((s) => s.isEnrolled || s.attended);

    const next = future.find((s) => s.isEnrolled) ?? future[0];
    if (next) {
      nextUp = {
        id: next.slug,
        title: next.title,
        speakerName: next.speaker.name,
        dateLabel: dateLabel(next.startsAt),
        timeLabel: timeLabel(next.startsAt),
        durationLabel: durationLabel(next.durationMin),
        description: next.description,
        startsAt: next.startsAt,
        durationMin: next.durationMin,
        joinUrl:
          next.isEnrolled || isDropInProgram(next.program)
            ? next.zoomJoinUrl
            : null,
        rrule: next.recurrence
          ? rruleFor(next.recurrence, next.recurrenceUntil)
          : null,
        allowCalendar: next.isEnrolled || isDropInProgram(next.program),
      };
    }

    upcoming = future.slice(0, 3).map((s) => {
      const status = displayStatus(s, now);
      return {
        id: s.slug,
        title: s.title,
        speakerName: s.speaker.name,
        month: monthShort(s.startsAt),
        day: dayOfMonth(s.startsAt),
        timeLabel: timeLabel(s.startsAt),
        pill: status === "live" ? "live" : status === "enrolled" ? "enrolled" : "upcoming",
        pillLabel: status === "live" ? "Live" : status === "enrolled" ? "Enrolled" : "Upcoming",
      };
    });
  }

  // Testimonial ask: shown after 2 weeks of membership, until submitted.
  const askForTestimonial =
    stats.memberSinceDays >= 14 && !(await hasTestimonial());

  // TSLS ticket perk (Admin → Billing): the member discount on next year's
  // summit tickets, shown while the offer is switched on.
  const perks = preview ? null : await getTslsPerks();
  const showPerk = Boolean(perks?.enabled && perks.url);

  const renewsLabel = member.accessExpiresAt
    ? new Date(member.accessExpiresAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="dash-pad">
      {/* House notices and top-of-dashboard placements (Ad Manager). Above
          the welcome banner because that's what "above the fold" means on
          the screen members land on. */}
      <AdSlot placement="dashboard_top" limit={2} />

      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-text">
          <Greeting name={firstName} />
          <p>
            {enrolledUpcoming > 0
              ? `You're enrolled in ${enrolledUpcoming} upcoming session${enrolledUpcoming === 1 ? "" : "s"}.`
              : stats.upcomingSessions > 0
                ? `${stats.upcomingSessions} session${stats.upcomingSessions === 1 ? "" : "s"} coming up on the calendar — grab a seat.`
                : "Welcome to your leadership home base."}
          </p>
          <div className="welcome-meta">
            <div className="welcome-meta-item">
              <strong>Day {stats.memberSinceDays}</strong> as a member
            </div>
            <div className="welcome-meta-item">
              <strong>{stats.sessionsAttended}</strong> sessions attended
            </div>
            <div className="welcome-meta-item">
              <strong>{member.tierLabel}</strong>
              {renewsLabel ? <> — access through {renewsLabel}</> : null}
            </div>
          </div>
        </div>
        <div className="welcome-actions">
          <Link href="/sessions" className="btn-gold">
            Browse Sessions
          </Link>
          <Link href="/community" className="btn-ghost">
            Community
          </Link>
        </div>
      </div>

      {/* First-steps guided tour — walks a new member through the portal;
          disappears once every step is done (or they skip it). */}
      <GettingStarted enrolled={hasEnrollment} prefsSaved={prefsSaved} />

      {/* Next Up Banner */}
      {nextUp ? (
        <div className="next-up-banner">
          <div className="next-up-dot" />
          <div>
            <div className="next-up-label">Next Session</div>
            <div className="next-up-title">{nextUp.title}</div>
            <div className="next-up-meta">
              <span>{nextUp.dateLabel}</span> &bull; {nextUp.timeLabel} &bull;{" "}
              {nextUp.durationLabel} &bull; with <span>{nextUp.speakerName}</span>
            </div>
          </div>
          <div className="next-up-actions">
            <Link href={`/sessions/${nextUp.id}`} className="btn-primary">
              View Details
            </Link>
            {nextUp.allowCalendar && (
              <AddToCalendarButton
                slug={nextUp.id}
                title={nextUp.title}
                description={nextUp.description}
                startsAt={nextUp.startsAt}
                durationMin={nextUp.durationMin}
                joinUrl={nextUp.joinUrl}
                rrule={nextUp.rrule}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="next-up-banner">
          <div>
            <div className="next-up-label" style={{ color: "var(--mid-gray)" }}>
              Next Session
            </div>
            <div className="next-up-title">Nothing scheduled yet</div>
            <div className="next-up-meta">
              New sessions will appear here the moment they&apos;re published.
            </div>
          </div>
          {member.isAdmin && (
            <div className="next-up-actions">
              <Link href="/admin/sessions/new" className="btn-primary">
                Create the first session
              </Link>
            </div>
          )}
        </div>
      )}

      {/* TSLS ticket perk — the member discount on next year's summit. */}
      {showPerk && perks && (
        <div className="admin-banner">
          <div className="admin-banner-icon">
            <StarIcon size={24} />
          </div>
          <div>
            <h3>{perks.headline || "Your TSLS ticket discount"}</h3>
            <p>
              {perks.blurb ||
                "Your Momentum+ membership includes a discount on next year's Tri-State Leadership Summit tickets."}
              {perks.code && (
                <>
                  {" "}
                  Use code{" "}
                  <strong style={{ letterSpacing: "0.04em" }}>
                    {perks.code}
                  </strong>{" "}
                  at checkout.
                </>
              )}
            </p>
          </div>
          <div className="admin-banner-actions">
            <a
              href={perks.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-sm-gold"
            >
              Get my ticket
            </a>
          </div>
        </div>
      )}

      <BodyAd variant="banner" />

      {/* Stat Grid */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon gold">
            <CalendarIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.upcomingSessions}</div>
            <div className="stat-lbl">Upcoming Sessions</div>
            <div className="stat-sub">On the calendar</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">
            <TargetIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.sessionsAttended}</div>
            <div className="stat-lbl">Sessions Attended</div>
            <div className="stat-sub">Your learning record</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <MessageIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.newMessages}</div>
            <div className="stat-lbl">New Messages</div>
            <div className="stat-sub">Community chat</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">
            <StarIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.memberSinceDays}</div>
            <div className="stat-lbl">Member Since (days)</div>
            <div className="stat-sub">{member.tierLabel}</div>
          </div>
        </div>
      </div>

      {/* Two Column Cards */}
      <div className="two-col">
        {/* Upcoming Sessions */}
        <div className="card">
          <div className="card-header">
            <h3>Upcoming Sessions</h3>
            <Link href="/sessions" className="card-link">
              View all <ChevronRightIcon size={10} />
            </Link>
          </div>
          <div className="upcoming-list">
            {upcoming.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: "var(--mid-gray)" }}>
                No sessions on the calendar yet.
              </div>
            ) : (
              upcoming.map((session) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className="upcoming-item"
                >
                  <div className="date-box">
                    <div className="date-box-month">{session.month}</div>
                    <div className="date-box-day">{session.day}</div>
                  </div>
                  <div className="upcoming-info">
                    <div className="upcoming-title">{session.title}</div>
                    <div className="upcoming-speaker">{session.speakerName}</div>
                  </div>
                  <div>
                    <div className="upcoming-time">{session.timeLabel}</div>
                    <div style={{ marginTop: 4 }}>
                      <span className={`status-pill ${session.pill}`}>
                        {session.pillLabel}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Community */}
        <div className="card">
          <div className="card-header">
            <h3>Recent Community</h3>
            <Link href="/community" className="card-link">
              Open chat <ChevronRightIcon size={10} />
            </Link>
          </div>
          <div className="activity-list">
            {preview ? (
              placeholderActivity.map((item) => (
                <div key={item.id} className="activity-item">
                  <div
                    className="activity-avatar"
                    style={{ background: item.avatarBg, color: item.avatarColor }}
                  >
                    {item.actorInitials}
                  </div>
                  <div className="activity-body">
                    <div className="activity-text">
                      <strong>{item.actorName}</strong> {item.text}{" "}
                      <span className="activity-tag">
                        <ChannelIcon size={10} /> {item.channel}
                      </span>
                    </div>
                    <div className="activity-time">{item.time}</div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: 16, fontSize: 13, color: "var(--mid-gray)" }}>
                <Link href="/community" style={{ color: "var(--gold)" }}>
                  Open the community
                </Link>{" "}
                to see what members are discussing.
              </div>
            )}
          </div>
        </div>
      </div>

      {askForTestimonial && (
        <TestimonialAsk memberName={member.name} defaultRole="" />
      )}

      {/* Admin Banner — only for admin-tier members */}
      {member.isAdmin && (
        <div className="admin-banner">
          <div className="admin-banner-icon">
            <ShieldIcon size={24} />
          </div>
          <div>
            <h3>Admin Access Enabled</h3>
            <p>
              You have administrator access to the Momentum+ portal. Manage
              members, sessions, and content from the Admin Panel.
            </p>
          </div>
          <div className="admin-banner-actions">
            <Link href="/admin" className="btn-sm-gold">
              Open Admin
            </Link>
            <Link href="/admin/sessions" className="btn-sm-ghost">
              Manage Sessions
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
