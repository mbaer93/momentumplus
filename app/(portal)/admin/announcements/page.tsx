import Link from "next/link";
import { AnnouncementComposer } from "@/components/admin/AnnouncementComposer";
import { ArrowLeftIcon } from "@/components/icons";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
  let recent: { id: string; title: string; sent_at: string; audience: string }[] = [];

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
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
    </div>
  );
}
