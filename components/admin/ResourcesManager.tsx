"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "./EntityManager";
import {
  createResource,
  deleteResource,
  updateResource,
  type ResourceInput,
} from "@/app/(portal)/admin/resources/actions";

const FIELDS: FieldDef[] = [
  { key: "title", label: "Title", type: "text", required: true },
  {
    key: "category",
    label: "Category",
    type: "text",
    placeholder: "Leadership, Business, Wellness, Communication…",
  },
  {
    key: "partnerName",
    label: "Partner / author",
    type: "text",
    placeholder: "e.g. Holly Bertone",
  },
  { key: "url", label: "Link (download or open)", type: "text", placeholder: "https://…" },
  { key: "description", label: "Description", type: "textarea" },
  {
    key: "minAccess",
    label: "Who can open it",
    type: "select",
    options: [
      { value: "all_members", label: "All members" },
      { value: "vip_plus", label: "VIP & annual only" },
      { value: "pro_only", label: "Pro members only (exclusive)" },
    ],
  },
  { key: "active", label: "Active (visible to members)", type: "checkbox" },
];

const EMPTY: EntityValues = {
  title: "",
  category: "",
  partnerName: "",
  url: "",
  description: "",
  minAccess: "all_members",
  active: true,
};

function toInput(v: EntityValues): ResourceInput {
  return {
    title: String(v.title ?? ""),
    category: String(v.category ?? ""),
    description: String(v.description ?? ""),
    url: String(v.url ?? ""),
    partnerName: String(v.partnerName ?? ""),
    minAccess:
      v.minAccess === "vip_plus" || v.minAccess === "pro_only"
        ? v.minAccess
        : "all_members",
    active: Boolean(v.active),
  };
}

export function ResourcesManager({
  rows,
  initialEditId,
}: {
  rows: EntityRow[];
  initialEditId?: string;
}) {
  return (
    <EntityManager
      entityLabel="resource"
      fields={FIELDS}
      rows={rows}
      emptyValues={EMPTY}
      initialEditId={initialEditId}
      onCreate={(v) => createResource(toInput(v))}
      onUpdate={(id, v) => updateResource(id, toInput(v))}
      onDelete={(id) => deleteResource(id)}
    />
  );
}
