"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "./EntityManager";
import {
  createVideo,
  deleteVideo,
  removeVideoThumbnail,
  updateVideo,
  uploadVideoThumbnail,
  type VideoInput,
} from "@/app/(portal)/admin/videos/actions";

const FIELDS: FieldDef[] = [
  { key: "title", label: "Title", type: "text", required: true },
  {
    key: "category",
    label: "Category",
    type: "select",
    options: [
      { value: "Leadership", label: "Leadership" },
      { value: "Wellness", label: "Wellness" },
      { value: "Business", label: "Business" },
    ],
  },
  // The video itself comes from the Upload panel — the Mux playback id rides
  // along in row values (never shown, never edited) so saves preserve it.
  { key: "durationMin", label: "Duration (minutes)", type: "number" },
  {
    key: "minAccess",
    label: "Who can watch",
    type: "select",
    options: [
      { value: "all_members", label: "All members" },
      { value: "vip_plus", label: "VIP & annual only" },
      { value: "pro_only", label: "Pro members only (exclusive)" },
    ],
  },
  { key: "published", label: "Published (visible in the Library)", type: "checkbox" },
];

const EMPTY: EntityValues = {
  title: "",
  category: "Leadership",
  muxPlaybackId: "",
  durationMin: 0,
  minAccess: "all_members",
  published: true,
};

function toInput(v: EntityValues): VideoInput {
  return {
    title: String(v.title ?? ""),
    category: String(v.category ?? ""),
    muxPlaybackId: String(v.muxPlaybackId ?? ""),
    durationMin: Number(v.durationMin ?? 0),
    minAccess:
      v.minAccess === "vip_plus" || v.minAccess === "pro_only"
        ? v.minAccess
        : "all_members",
    published: Boolean(v.published),
  };
}

/**
 * Thumbnail controls in a recording's edit row. The card defaults to a
 * screen grab from the video; an uploaded image overrides it.
 */
function ThumbnailControls({ row }: { row: EntityRow }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const customUrl = String(row.values.thumbnailUrl ?? "");
  const previewUrl = customUrl || String(row.values.defaultThumbUrl ?? "");

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — try again.", ok: false });
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="admin-field" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 13 }}>
          Card thumbnail — defaults to a screen grab from the video; upload an
          image (PNG/JPG/WebP, &lt;4 MB) to use your own instead
        </label>
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt={customUrl ? "Custom thumbnail" : "Video screen grab"}
            style={{
              width: 120,
              height: 68,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--warm-gray)",
            }}
          />
        )}
        <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
          {customUrl
            ? "Using uploaded thumbnail"
            : previewUrl
              ? "Using video screen grab (default)"
              : "No video yet — upload a thumbnail or add the video first"}
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          ref={fileRef}
          style={{ fontSize: 12 }}
          aria-label="Thumbnail file"
        />
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          onClick={() => {
            const file = fileRef.current?.files?.[0];
            if (!file) {
              setMsg({ text: "Choose an image file first.", ok: false });
              return;
            }
            const fd = new FormData();
            fd.append("file", file);
            run(() => uploadVideoThumbnail(row.id, fd));
          }}
        >
          {pending ? "Working…" : "Upload thumbnail"}
        </button>
        {customUrl && (
          <button
            type="button"
            className="btn-mini danger"
            disabled={pending}
            onClick={() => run(() => removeVideoThumbnail(row.id))}
          >
            Use screen grab instead
          </button>
        )}
      </div>
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginTop: 6 }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

export function VideosManager({
  rows,
  initialEditId,
}: {
  rows: EntityRow[];
  initialEditId?: string;
}) {
  return (
    <EntityManager
      entityLabel="recording"
      fields={FIELDS}
      rows={rows}
      emptyValues={EMPTY}
      initialEditId={initialEditId}
      allowCreate={false}
      renderRowExtras={(row) => <ThumbnailControls row={row} />}
      onCreate={(v) => createVideo(toInput(v))}
      onUpdate={(id, v) => updateVideo(id, toInput(v))}
      onDelete={(id) => deleteVideo(id)}
    />
  );
}
