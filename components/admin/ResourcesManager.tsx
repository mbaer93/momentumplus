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
  createResource,
  deleteResource,
  pullResourceImage,
  removeResourceImage,
  updateResource,
  uploadResourceImage,
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
      { value: "vip_plus", label: "Exclusive — Pro, speakers & sponsors" },
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

/** Card-image controls in a resource's edit row: pull from link / upload / remove. */
function ImageControls({ row }: { row: EntityRow }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const imageUrl = String(row.values.imageUrl ?? "");

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMsg(res.message ? { text: res.message, ok: res.ok } : null);
        if (res.ok) router.refresh();
      } catch {
        setMsg({ text: "That didn't save — refresh this page and try again (the app may have just been updated).", ok: false });
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="admin-field" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 13 }}>
          Card image — pulled from the link&apos;s preview or uploaded
          (PNG/JPG/WebP/GIF/SVG, &lt;4 MB)
        </label>
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Current card image"
            style={{
              width: 84,
              height: 84,
              objectFit: "cover",
              borderRadius: 10,
              border: "1px solid var(--warm-gray)",
            }}
          />
        )}
        <button
          type="button"
          className="btn-mini"
          disabled={pending}
          onClick={() => run(() => pullResourceImage(row.id))}
        >
          {pending ? "Working…" : "Pull image from link"}
        </button>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          ref={fileRef}
          style={{ fontSize: 12 }}
          aria-label="Card image file"
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
            run(() => uploadResourceImage(row.id, fd));
          }}
        >
          Upload image
        </button>
        {imageUrl && (
          <button
            type="button"
            className="btn-mini danger"
            disabled={pending}
            onClick={() => run(() => removeResourceImage(row.id))}
          >
            Remove
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
      createHint="Card image: pulled from the link automatically when you add — or click Edit on the row to upload/replace it."
      renderRowExtras={(row) => <ImageControls row={row} />}
      onCreate={(v) => createResource(toInput(v))}
      onUpdate={(id, v) => updateResource(id, toInput(v))}
      onDelete={(id) => deleteResource(id)}
    />
  );
}
