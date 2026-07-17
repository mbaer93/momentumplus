"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "./EntityManager";
import {
  createService,
  deleteService,
  updateService,
  type ServiceInput,
} from "@/app/(portal)/admin/services/actions";

const FIELDS: FieldDef[] = [
  { key: "name", label: "Service name", type: "text", required: true },
  {
    key: "tagline",
    label: "Tagline (shown above the name on the card)",
    type: "text",
    placeholder: "e.g. 1-on-1 executive coaching",
  },
  { key: "description", label: "Description", type: "textarea" },
  {
    key: "url",
    label: "Sign-up link",
    type: "text",
    placeholder: "https://… (where the Sign up button goes)",
  },
  {
    key: "priceLabel",
    label: "Price label (optional)",
    type: "text",
    placeholder: "e.g. $500/mo, or leave blank",
  },
  {
    key: "sortOrder",
    label: "Sort order (lower = higher on the page)",
    type: "text",
    placeholder: "0",
  },
  { key: "active", label: "Visible to members", type: "checkbox" },
];

const EMPTY: EntityValues = {
  name: "",
  tagline: "",
  description: "",
  url: "",
  priceLabel: "",
  sortOrder: "0",
  active: true,
};

function toInput(v: EntityValues): ServiceInput {
  return {
    name: String(v.name ?? ""),
    tagline: String(v.tagline ?? ""),
    description: String(v.description ?? ""),
    url: String(v.url ?? ""),
    priceLabel: String(v.priceLabel ?? ""),
    sortOrder: String(v.sortOrder ?? "0"),
    active: Boolean(v.active),
  };
}

export function ServicesManager({
  rows,
  initialEditId,
}: {
  rows: EntityRow[];
  initialEditId?: string;
}) {
  return (
    <EntityManager
      entityLabel="service"
      fields={FIELDS}
      rows={rows}
      emptyValues={EMPTY}
      initialEditId={initialEditId}
      onCreate={(v) => createService(toInput(v))}
      onUpdate={(id, v) => updateService(id, toInput(v))}
      onDelete={(id) => deleteService(id)}
    />
  );
}
