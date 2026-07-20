import Link from "next/link";
import { AnnouncementComposer } from "@/components/admin/AnnouncementComposer";
import {
  ScheduledPostsManager,
  type ScheduledPostRow,
} from "@/components/admin/ScheduledPostsManager";
import { ArrowLeftIcon } from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
// Server actions on this page fan out per-member work — allow the full window.
export const maxDuration = 300;

export default async function AdminAnnouncementsPage() {
  let recent: { id: string; title: string; sent_at: string; audience: string }[] = [];
  let scheduled: ScheduledPostRow[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    // Tolerant of the table not existing yet (pre-migration deploys).
    const { data: sp } = await admin
      .from("scheduled_posts")
      .select("id, channel, body, send_at, sent_at")
      .order("send_at", { ascending: true })
      .limit(50);
    scheduled = (sp ?? []).map((r) => ({
      id: r.id,
      channel: r.channel,
      body: r.body,
      sendAt: r.send_at,
      sentAt: r.sent_at,
    }));
    const { data } = await admin
      .from("announcements")
      .select("id, title, sent_at, audience_tiers")
      .order("sent_at", { ascending: false })
      .limit(10);
    recent = (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      sent_at: a.sent_at
        ? new Date(a.sent_at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "",
      audience: (a.audience_tiers ?? []).join(", "),
    }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Announcements</h2>
          <p>Compose and send to members by tier — respects member preferences</p>
        </div>
      </div>

      <div className="two-col" style={{ alignItems: "start" }}>
        <AnnouncementComposer />
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

      <ScheduledPostsManager rows={scheduled} />
    </div>
  );
}
