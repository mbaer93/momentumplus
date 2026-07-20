"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "@/components/admin/EntityManager";
import {
  createSpeaker,
  deleteSpeaker,
  updateSpeaker,
  type SpeakerInput,
} from "@/app/(app)/admin/actions";

const FIELDS: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "title", label: "Title / role", type: "text", placeholder: "e.g. Keynote — Servant Leadership" },
  { key: "headshotUrl", label: "Headshot URL (optional)", type: "text", placeholder: "https://…" },
  { key: "website", label: "Website (optional)", type: "text", placeholder: "https://…" },
  { key: "tags", label: "Topic tags (comma-separated)", type: "text", placeholder: "Leadership, Marketing" },
  { key: "bio", label: "Bio", type: "textarea" },
  {
    key: "sortOrder",
    label: "Sort order (lower = higher on the page)",
    type: "text",
    placeholder: "0",
  },
  { key: "active", label: "Visible to attendees", type: "checkbox" },
];

function toInput(v: EntityValues): SpeakerInput {
  return {
    name: String(v.name ?? ""),
    title: String(v.title ?? ""),
    bio: String(v.bio ?? ""),
    headshotUrl: String(v.headshotUrl ?? ""),
    website: String(v.website ?? ""),
    tags: String(v.tags ?? ""),
    sortOrder: String(v.sortOrder ?? "0"),
    active: Boolean(v.active),
  };
}

export function EventSpeakersManager({ rows }: { rows: EntityRow[] }) {
  return (
    <EntityManager
      entityLabel="speaker"
      fields={FIELDS}
      rows={rows}
      emptyValues={{
        name: "",
        title: "",
        bio: "",
        headshotUrl: "",
        website: "",
        tags: "",
        sortOrder: "0",
        active: true,
      }}
      onCreate={(v) => createSpeaker(toInput(v))}
      onUpdate={(id, v) => updateSpeaker(id, toInput(v))}
      onDelete={(id) => deleteSpeaker(id)}
    />
  );
}
