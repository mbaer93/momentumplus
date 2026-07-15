import Link from "next/link";
import { VideosManager } from "@/components/admin/VideosManager";
import { VideoUploader } from "@/components/admin/VideoUploader";
import type { EntityRow } from "@/components/admin/EntityManager";
import { ArrowLeftIcon } from "@/components/icons";
import { isMuxConfigured, muxThumbnailUrl } from "@/lib/mux";
import { placeholderVideos } from "@/lib/videos/data";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminVideosPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  let rows: EntityRow[] = placeholderVideos.map((v) => ({
    id: v.id,
    title: v.title,
    subtitle: `${v.speakerName}${v.durationLabel ? ` · ${v.durationLabel}` : ""}`,
    badge: v.minAccess === "vip_plus" ? "VIP+" : undefined,
    values: {
      title: v.title,
      category: v.category,
      muxPlaybackId: v.muxPlaybackId ?? "",
      durationMin: parseInt(v.durationLabel, 10) || 0,
      minAccess: v.minAccess,
      published: true,
    },
  }));

  if (isSupabaseConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServiceClient();
    const { data } = await admin
      .from("videos")
      .select("id, title, category, mux_playback_id, thumbnail_url, duration_sec, min_access, published_at")
      .order("published_at", { ascending: false, nullsFirst: true });
    rows = (data ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      subtitle: [
        v.category ?? "Uncategorized",
        v.duration_sec ? `${Math.round(v.duration_sec / 60)} min` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      badge: !v.published_at
        ? "Draft"
        : v.min_access === "pro_only"
          ? "Pro"
          : v.min_access === "vip_plus"
            ? "VIP+"
            : undefined,
      values: {
        title: v.title,
        category: v.category ?? "Leadership",
        muxPlaybackId: v.mux_playback_id ?? "",
        thumbnailUrl: v.thumbnail_url ?? "",
        defaultThumbUrl:
          v.mux_playback_id && isMuxConfigured()
            ? muxThumbnailUrl(v.mux_playback_id)
            : "",
        durationMin: v.duration_sec ? Math.round(v.duration_sec / 60) : 0,
        minAccess: v.min_access,
        published: Boolean(v.published_at),
      },
    }));
  }

  return (
    <div className="admin-pad">
      <Link href="/admin" className="sess-back">
        <ArrowLeftIcon size={12} /> Admin
      </Link>
      <div className="section-header">
        <div>
          <h2>Library</h2>
          <p>Recordings members see in the Session Library</p>
        </div>
      </div>
      {!isSupabaseConfigured() && (
        <div className="admin-hint">
          Preview mode: sample recordings. Changes persist once Supabase is
          connected.
        </div>
      )}
      <VideoUploader muxConnected={isMuxConfigured()} />
      <VideosManager rows={rows} initialEditId={searchParams?.edit} />
    </div>
  );
}
