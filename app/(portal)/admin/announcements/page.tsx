import { AnnouncementComposer } from "@/components/admin/AnnouncementComposer";
import { OffersManager } from "@/components/admin/OffersManager";
import {
  ScheduledAnnouncements,
  type ScheduledAnnouncementRow,
} from "@/components/admin/ScheduledAnnouncements";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { formatAt } from "@/lib/time-format";

export const dynamic = "force-dynamic";
// Server actions on this page fan out per-member work — allow the full window.
export const maxDuration = 300;

/* One composer, both timings (Matt, 2026-08-05): Send Now or Schedule live
   together — the old separate "scheduled posts" section is gone. Scheduled
   announcements appear in the Scheduled card until the cron delivers them. */
export default async function AdminAnnouncementsPage() {
  let recent: { id: string; title: string; sent_at: string; audience: string }[] = [];
  let scheduled: ScheduledAnnouncementRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    // Pre-migration-0075 (no send_at column) degrades to an empty list.
    const { data: due } = await admin
      .from("announcements")
      .select("id, title, send_at, audience_tiers, channels")
      .is("sent_at", null)
      .not("send_at", "is", null)
      .order("send_at", { ascending: true })
      .limit(50);
    scheduled = (due ?? []).map((a) => ({
      id: a.id as string,
      title: a.title as string,
      whenLabel: a.send_at
        ? formatAt(a.send_at as string, "monthDayTime")
        : "",
      audience: ((a.audience_tiers as string[]) ?? []).join(", "),
      channels: ((a.channels as string[]) ?? []).join(" + "),
    }));

    const { data } = await admin
      .from("announcements")
      .select("id, title, sent_at, audience_tiers")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(10);
    recent = (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      sent_at: a.sent_at
        ? formatAt(a.sent_at, "monthDayTime")
        : "",
      audience: (a.audience_tiers ?? []).join(", "),
    }));
  }

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Announcements</h2>
          <p>
            Compose, then send now or schedule — respects member preferences
          </p>
        </div>
      </div>

      <div className="two-col" style={{ alignItems: "start" }}>
        <AnnouncementComposer />

        {/* Targeted offers — the same audiences, shown in the app instead of
            sent (Matt, 2026-08-19). */}
        <OffersManager />
        <div style={{ display: "grid", gap: 16 }}>
          <ScheduledAnnouncements rows={scheduled} />
          <div className="card">
            <div className="card-header">
              <h3>Recently sent</h3>
            </div>
            <div style={{ padding: 16 }}>
              {recent.length === 0 ? (
                <div className="sess-empty-note">
                  {isSupabaseConfigured()
                    ? "Nothing sent yet."
                    : "Preview mode — sent announcements will appear here."}
                </div>
              ) : (
                recent.map((a) => (
                  <div key={a.id} className="profile-kv">
                    <div className="k">
                      {a.sent_at} · {a.audience}
                    </div>
                    <strong>{a.title}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
