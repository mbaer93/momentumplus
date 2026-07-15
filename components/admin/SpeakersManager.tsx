"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "./EntityManager";
import {
  createSpeaker,
  deleteSpeaker,
  updateSpeaker,
  type SpeakerInput,
} from "@/app/(portal)/admin/speakers/actions";

const FIELDS: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true },
  {
    key: "title",
    label: "Title / role",
    type: "text",
    placeholder: "e.g. Executive Leadership Coach",
  },
  {
    key: "industries",
    label: "Topics (comma-separated)",
    type: "text",
    placeholder: "Leadership, Resilience, Mindset",
  },
  { key: "bio", label: "Bio", type: "textarea" },
  { key: "featured", label: "Featured (shown first)", type: "checkbox" },
];

const EMPTY: EntityValues = {
  name: "",
  title: "",
  industries: "",
  bio: "",
  featured: false,
};

function toInput(v: EntityValues): SpeakerInput {
  return {
    name: String(v.name ?? ""),
    title: String(v.title ?? ""),
    bio: String(v.bio ?? ""),
    industries: String(v.industries ?? ""),
    featured: Boolean(v.featured),
  };
}

export function SpeakersManager({
  rows,
  initialEditId,
}: {
  rows: EntityRow[];
  initialEditId?: string;
}) {
  return (
    <EntityManager
      entityLabel="speaker"
      fields={FIELDS}
      rows={rows}
      emptyValues={EMPTY}
      initialEditId={initialEditId}
      onCreate={(v) => createSpeaker(toInput(v))}
      onUpdate={(id, v) => updateSpeaker(id, toInput(v))}
      onDelete={(id) => deleteSpeaker(id)}
    />
  );
}
