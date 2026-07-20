"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "@/components/admin/EntityManager";
import {
  createAgendaItem,
  deleteAgendaItem,
  updateAgendaItem,
  type AgendaInput,
} from "@/app/(app)/admin/actions";

const KIND_OPTIONS = [
  { value: "keynote", label: "Keynote" },
  { value: "session", label: "Session" },
  { value: "workshop", label: "Workshop" },
  { value: "panel", label: "Panel" },
  { value: "break", label: "Break" },
  { value: "meal", label: "Meal" },
  { value: "networking", label: "Networking" },
  { value: "registration", label: "Registration / Check-in" },
  { value: "other", label: "Other" },
];

function fields(speakers: { value: string; label: string }[]): FieldDef[] {
  return [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "kind", label: "Type", type: "select", options: KIND_OPTIONS },
    {
      key: "date",
      label: "Date (YYYY-MM-DD, Eastern)",
      type: "text",
      placeholder: "2026-10-14",
      required: true,
    },
    {
      key: "startTime",
      label: "Start time (ET)",
      type: "text",
      placeholder: "9:00 AM",
      required: true,
    },
    {
      key: "endTime",
      label: "End time (ET, optional)",
      type: "text",
      placeholder: "10:15 AM",
    },
    { key: "location", label: "Location / room", type: "text", placeholder: "Main Stage" },
    { key: "track", label: "Track (optional)", type: "text", placeholder: "Marketing" },
    {
      key: "speakerId",
      label: "Speaker (optional)",
      type: "select",
      options: [{ value: "", label: "— none —" }, ...speakers],
    },
    { key: "description", label: "Description", type: "textarea" },
    { key: "vipOnly", label: "VIP experience block", type: "checkbox" },
    { key: "published", label: "Visible to attendees", type: "checkbox" },
  ];
}

function toInput(v: EntityValues, eventYear: number): AgendaInput {
  return {
    title: String(v.title ?? ""),
    kind: String(v.kind ?? "session"),
    date: String(v.date ?? ""),
    startTime: String(v.startTime ?? ""),
    endTime: String(v.endTime ?? ""),
    location: String(v.location ?? ""),
    track: String(v.track ?? ""),
    speakerId: String(v.speakerId ?? ""),
    description: String(v.description ?? ""),
    vipOnly: Boolean(v.vipOnly),
    published: Boolean(v.published),
    eventYear,
  };
}

export function AgendaManager({
  rows,
  speakers,
  eventYear,
  defaultDate,
}: {
  rows: EntityRow[];
  speakers: { value: string; label: string }[];
  eventYear: number;
  defaultDate: string;
}) {
  return (
    <EntityManager
      entityLabel="agenda item"
      fields={fields(speakers)}
      rows={rows}
      emptyValues={{
        title: "",
        kind: "session",
        date: defaultDate,
        startTime: "",
        endTime: "",
        location: "",
        track: "",
        speakerId: "",
        description: "",
        vipOnly: false,
        published: true,
      }}
      onCreate={(v) => createAgendaItem(toInput(v, eventYear))}
      onUpdate={(id, v) => updateAgendaItem(id, toInput(v, eventYear))}
      onDelete={(id) => deleteAgendaItem(id)}
    />
  );
}
