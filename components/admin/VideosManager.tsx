"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "./EntityManager";
import {
  createVideo,
  deleteVideo,
  updateVideo,
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
      onCreate={(v) => createVideo(toInput(v))}
      onUpdate={(id, v) => updateVideo(id, toInput(v))}
      onDelete={(id) => deleteVideo(id)}
    />
  );
}
