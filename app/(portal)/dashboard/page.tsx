import Link from "next/link";
import {
  CalendarIcon,
  CalendarSmallIcon,
  ChannelIcon,
  ChevronRightIcon,
  MessageIcon,
  ShieldIcon,
  StarIcon,
  TargetIcon,
} from "@/components/icons";
import { getCurrentMember } from "@/lib/current-member";
import {
  placeholderActivity,
  placeholderNextSession,
  placeholderStats,
  placeholderUpcoming,
} from "@/lib/placeholder-data";

export default async function DashboardPage() {
  const member = await getCurrentMember();
  const firstName = member.name.split(" ")[0];
  const stats = placeholderStats;

  return (
    <div className="dash-pad">
      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-text">
          <h1>Good morning, {firstName}</h1>
          <p>
            You have {stats.upcomingSessions} upcoming sessions this month and{" "}
            {stats.newMessages} new community messages waiting.
          </p>
          <div className="welcome-meta">
            <div className="welcome-meta-item">
              <strong>Day {stats.memberSinceDays}</strong> as a member
            </div>
            <div className="welcome-meta-item">
              <strong>{stats.sessionsAttended}</strong> sessions attended
            </div>
            <div className="welcome-meta-item">
              <strong>{member.tierLabel}</strong> — renews Mar 2027
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

      {/* Next Up Banner */}
      <div className="next-up-banner">
        <div className="next-up-dot" />
        <div>
          <div className="next-up-label">Next Session</div>
          <div className="next-up-title">{placeholderNextSession.title}</div>
          <div className="next-up-meta">
            <span>{placeholderNextSession.dateLabel}</span> &bull;{" "}
            {placeholderNextSession.timeLabel} &bull;{" "}
            {placeholderNextSession.durationLabel} &bull; with{" "}
            <span>{placeholderNextSession.speakerName}</span>
          </div>
        </div>
        <div className="next-up-actions">
          <Link
            href={`/sessions/${placeholderNextSession.id}`}
            className="btn-primary"
          >
            View Details
          </Link>
          <button className="cal-btn" type="button">
            <CalendarSmallIcon size={12} />
            Add to Calendar
          </button>
        </div>
      </div>

      {/* Stat Grid */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon gold">
            <CalendarIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.upcomingSessions}</div>
            <div className="stat-lbl">Upcoming Sessions</div>
            <div className="stat-sub">This month</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">
            <TargetIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.sessionsAttended}</div>
            <div className="stat-lbl">Sessions Attended</div>
            <div className="stat-sub">+4 this quarter</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <MessageIcon size={20} />
          </div>
          <div>
            <div className="stat-val">{stats.newMessages}</div>
            <div className="stat-lbl">New Messages</div>
            <div className="stat-sub">3 mentions</div>
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
            {placeholderUpcoming.map((session) => (
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
                    <span className="status-pill upcoming">Upcoming</span>
                  </div>
                </div>
              </Link>
            ))}
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
            {placeholderActivity.map((item) => (
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
            ))}
          </div>
        </div>
      </div>

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
            <button className="btn-sm-ghost" type="button">
              View Reports
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
