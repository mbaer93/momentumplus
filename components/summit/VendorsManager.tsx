"use client";

import {
  EntityManager,
  type EntityRow,
  type EntityValues,
  type FieldDef,
} from "@/components/admin/EntityManager";
import {
  createVendor,
  deleteVendor,
  updateVendor,
  type VendorInput,
} from "@/app/summit/admin/actions";

const FIELDS: FieldDef[] = [
  { key: "name", label: "Vendor name", type: "text", required: true },
  { key: "tagline", label: "Tagline", type: "text", placeholder: "e.g. Local roaster, event coffee bar" },
  { key: "category", label: "Category", type: "text", placeholder: "e.g. Marketing" },
  { key: "booth", label: "Booth / table", type: "text", placeholder: "e.g. Lobby 4" },
  { key: "website", label: "Website", type: "text", placeholder: "https://…" },
  { key: "logoUrl", label: "Logo URL (optional)", type: "text", placeholder: "https://…" },
  {
    key: "offer",
    label: "Attendee offer (shown on the card)",
    type: "text",
    placeholder: "e.g. 10% off orders placed at the booth",
  },
  { key: "description", label: "Description", type: "textarea" },
  {
    key: "sortOrder",
    label: "Sort order (lower = higher on the page)",
    type: "text",
    placeholder: "0",
  },
  { key: "active", label: "Visible to attendees", type: "checkbox" },
];

function toInput(v: EntityValues, eventYear: number): VendorInput {
  return {
    name: String(v.name ?? ""),
    tagline: String(v.tagline ?? ""),
    category: String(v.category ?? ""),
    booth: String(v.booth ?? ""),
    website: String(v.website ?? ""),
    logoUrl: String(v.logoUrl ?? ""),
    offer: String(v.offer ?? ""),
    description: String(v.description ?? ""),
    sortOrder: String(v.sortOrder ?? "0"),
    active: Boolean(v.active),
    eventYear,
  };
}

export function VendorsManager({
  rows,
  eventYear,
}: {
  rows: EntityRow[];
  eventYear: number;
}) {
  return (
    <EntityManager
      entityLabel="vendor"
      fields={FIELDS}
      rows={rows}
      emptyValues={{
        name: "",
        tagline: "",
        category: "",
        booth: "",
        website: "",
        logoUrl: "",
        offer: "",
        description: "",
        sortOrder: "0",
        active: true,
      }}
      onCreate={(v) => createVendor(toInput(v, eventYear))}
      onUpdate={(id, v) => updateVendor(id, toInput(v, eventYear))}
      onDelete={(id) => deleteVendor(id)}
    />
  );
}
