import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/*
 * Engagement analytics: who enrolled/attended each session, sponsor
 * impressions + clicks, and what members open most (resources, videos).
 * Read-only; all counts come from tables the app already writes to
 * (enrollments, sponsor_events, resource_uses, video_views).
 */

interface SessionReport {
  id: string;
  title: string;
  dateLabel: string;
  enrolled: { name: string; email: string; attended: boolean }[];
}

interface SponsorReport {
  id: string;
  name: string;
  impressions30: number;
  clicks30: number;
  impressionsAll: number;
  clicksAll: number;
}

interface CountRow {
  id: string;
  title: string;
  count30: number;
  countAll: number;
  extra?: string;
}

function ctr(clicks: number, impressions: number): string {
  if (!impressions) return "—";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

export default async function AdminAnalyticsPage() {
  const configured =
    isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  let sessions: SessionReport[] = [];
  let sponsors: SponsorReport[] = [];
  let resources: CountRow[] = [];
  let videos: CountRow[] = [];

  if (configured) {
    const admin = createServiceClient();
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const [
      { data: sessionRows },
      { data: sponsorRows },
      { data: sponsorEvents },
      { data: resourceRows },
      { data: resourceUses },
      { data: videoRows },
      { data: videoViews },
    ] = await Promise.all([
      admin
        .from("sessions")
        .select("id, title, starts_at")
        .not("starts_at", "is", null) // drafts with no date aren't reportable
        .order("starts_at", { ascending: false })
        .limit(24),
      admin.from("sponsors").select("id, name").order("name"),
      admin.from("sponsor_events").select("sponsor_id, kind, at"),
      admin.from("resources").select("id, title"),
      admin.from("resource_uses").select("resource_id, used_at"),
      admin.from("videos").select("id, title"),
      admin.from("video_views").select("video_id, profile_id, watched_at"),
    ]);

    // Rosters only for the sessions on the page — not every enrollment ever.
    const { data: enrollmentRows } = await admin
      .from("enrollments")
      .select("session_id, attended, profiles ( full_name, email )")
      .in(
        "session_id",
        (sessionRows ?? []).map((s) => s.id),
      );

    type EnrollRow = {
      session_id: string;
      attended: boolean;
      profiles: { full_name: string | null; email: string | null } | null;
    };
    const bySession = new Map<string, SessionReport["enrolled"]>();
    for (const e of (enrollmentRows ?? []) as unknown as EnrollRow[]) {
      const list = bySession.get(e.session_id) ?? [];
      list.push({
        name: e.profiles?.full_name || e.profiles?.email || "Member",
        email: e.profiles?.email ?? "",
        attended: e.attended,
      });
      bySession.set(e.session_id, list);
    }
    sessions = (sessionRows ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      dateLabel: new Date(s.starts_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      enrolled: (bySession.get(s.id) ?? []).sort((a, b) =>
        Number(b.attended) - Number(a.attended) || a.name.localeCompare(b.name),
      ),
    }));

    const spCounts = new Map<
      string,
      { i30: number; c30: number; iAll: number; cAll: number }
    >();
    for (const e of sponsorEvents ?? []) {
      const c =
        spCounts.get(e.sponsor_id) ?? { i30: 0, c30: 0, iAll: 0, cAll: 0 };
      const recent = e.at >= cutoff;
      if (e.kind === "click") {
        c.cAll++;
        if (recent) c.c30++;
      } else {
        c.iAll++;
        if (recent) c.i30++;
      }
      spCounts.set(e.sponsor_id, c);
    }
    sponsors = (sponsorRows ?? []).map((s) => {
      const c = spCounts.get(s.id) ?? { i30: 0, c30: 0, iAll: 0, cAll: 0 };
      return {
        id: s.id,
        name: s.name,
        impressions30: c.i30,
        clicks30: c.c30,
        impressionsAll: c.iAll,
        clicksAll: c.cAll,
      };
    });

    const tally = (
      rows: { id: string; title: string }[],
      uses: { key: string; at: string }[],
    ): CountRow[] => {
      const counts = new Map<string, { c30: number; cAll: number }>();
      for (const u of uses) {
        const c = counts.get(u.key) ?? { c30: 0, cAll: 0 };
        c.cAll++;
        if (u.at >= cutoff) c.c30++;
        counts.set(u.key, c);
      }
      return rows
        .map((r) => ({
          id: r.id,
          title: r.title,
          count30: counts.get(r.id)?.c30 ?? 0,
          countAll: counts.get(r.id)?.cAll ?? 0,
        }))
        .filter((r) => r.countAll > 0)
        .sort((a, b) => b.count30 - a.count30 || b.countAll - a.countAll)
        .slice(0, 12);
    };

    resources = tally(
      resourceRows ?? [],
      (resourceUses ?? []).map((u) => ({ key: u.resource_id, at: u.used_at })),
    );
    const uniqueViewers = new Map<string, Set<string>>();
    for (const v of videoViews ?? []) {
      const set = uniqueViewers.get(v.video_id) ?? new Set<string>();
      set.add(v.profile_id);
      uniqueViewers.set(v.video_id, set);
    }
    videos = tally(
      videoRows ?? [],
      (videoViews ?? []).map((v) => ({ key: v.video_id, at: v.watched_at })),
    ).map((v) => ({
      ...v,
      extra: `${uniqueViewers.get(v.id)?.size ?? 0} member${
        (uniqueViewers.get(v.id)?.size ?? 0) === 1 ? "" : "s"
      }`,
    }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Analytics</h2>
          <p>
            Session engagement, sponsor performance, and what members open most
          </p>
        </div>
      </div>

      {!configured && (
        <div className="admin-hint">
          Preview mode: analytics fill in from real member activity once
          Supabase is connected.
        </div>
      )}

      {/* Session engagement */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header">
          <h3>Session Engagement</h3>
        </div>
        <div style={{ padding: "6px 18px 14px" }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 12, color: "var(--mid-gray)", fontSize: 13 }}>
              No sessions yet.
            </div>
          ) : (
            sessions.map((s) => {
              const attended = s.enrolled.filter((e) => e.attended).length;
              return (
                <details key={s.id} className="an-session">
                  <summary className="an-session-summary">
                    <span className="an-session-title">{s.title}</span>
                    <span className="an-session-meta">
                      {s.dateLabel} · {s.enrolled.length} enrolled · {attended}{" "}
                      attended
                    </span>
                  </summary>
                  {s.enrolled.length === 0 ? (
                    <div className="an-empty">No enrollments.</div>
                  ) : (
                    <table className="an-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Email</th>
                          <th>Attended</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.enrolled.map((e, i) => (
                          <tr key={i}>
                            <td>{e.name}</td>
                            <td>{e.email}</td>
                            <td>
                              {e.attended ? (
                                <span className="an-yes">Yes</span>
                              ) : (
                                <span className="an-no">Enrolled only</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </details>
              );
            })
          )}
        </div>
      </div>

      {/* Sponsor performance */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header">
          <h3>Sponsor Performance</h3>
          <span style={{ fontSize: 12, color: "var(--mid-gray)" }}>
            Ad views and clicks — share these with sponsors
          </span>
        </div>
        <div style={{ padding: "6px 18px 14px", overflowX: "auto" }}>
          {sponsors.length === 0 ? (
            <div style={{ padding: 12, color: "var(--mid-gray)", fontSize: 13 }}>
              No sponsors yet.
            </div>
          ) : (
            <table className="an-table">
              <thead>
                <tr>
                  <th>Sponsor</th>
                  <th>Views (30 days)</th>
                  <th>Clicks (30 days)</th>
                  <th>CTR (30 days)</th>
                  <th>Views (all time)</th>
                  <th>Clicks (all time)</th>
                </tr>
              </thead>
              <tbody>
                {sponsors.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>{s.impressions30}</td>
                    <td>{s.clicks30}</td>
                    <td>{ctr(s.clicks30, s.impressions30)}</td>
                    <td>{s.impressionsAll}</td>
                    <td>{s.clicksAll}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="sp-grid-2">
        {/* Top resources */}
        <div className="card">
          <div className="card-header">
            <h3>Most-Opened Resources</h3>
          </div>
          <div style={{ padding: "6px 18px 14px" }}>
            {resources.length === 0 ? (
              <div style={{ padding: 12, color: "var(--mid-gray)", fontSize: 13 }}>
                No resource opens recorded yet.
              </div>
            ) : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>30 days</th>
                    <th>All time</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td>{r.count30}</td>
                      <td>{r.countAll}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Top videos */}
        <div className="card">
          <div className="card-header">
            <h3>Most-Watched Recordings</h3>
          </div>
          <div style={{ padding: "6px 18px 14px" }}>
            {videos.length === 0 ? (
              <div style={{ padding: 12, color: "var(--mid-gray)", fontSize: 13 }}>
                No video views recorded yet.
              </div>
            ) : (
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Recording</th>
                    <th>Views (30 days)</th>
                    <th>All time</th>
                    <th>Watched by</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id}>
                      <td>{v.title}</td>
                      <td>{v.count30}</td>
                      <td>{v.countAll}</td>
                      <td>{v.extra}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
