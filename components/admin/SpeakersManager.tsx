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
  createSpeaker,
  deleteSpeaker,
  removeSpeakerHeadshot,
  updateSpeaker,
  uploadSpeakerHeadshot,
  type SpeakerInput,
} from "@/app/(portal)/admin/speakers/actions";

/* Speaker-of-the-month options: fixed window covering the published
   schedule (Oct 2026 – Sep 2027) plus two seasons of headroom. A static
   list keeps server and client renders identical. */
const MONTH_OPTIONS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [
    { value: "", label: "— No month assigned —" },
  ];
  for (let i = 0; i < 36; i++) {
    const d = new Date(Date.UTC(2026, 9 + i, 15));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      value,
      label: d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  return out;
})();

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
  {
    key: "website",
    label: "Website",
    type: "text",
    placeholder: "https://…",
  },
  { key: "bio", label: "Bio", type: "textarea" },
  { key: "featured", label: "Featured (shown first)", type: "checkbox" },
  {
    key: "speakerMonth",
    label: "Momentum+ month (speaker of the month)",
    type: "select",
    options: MONTH_OPTIONS,
  },
  {
    key: "tslsMainSpeaker",
    label: "TSLS Main Speaker (unpaid — no 15% earnings share)",
    type: "checkbox",
  },
];

const EMPTY: EntityValues = {
  name: "",
  title: "",
  industries: "",
  website: "",
  bio: "",
  featured: false,
  speakerMonth: "",
  tslsMainSpeaker: false,
};

function toInput(v: EntityValues): SpeakerInput {
  return {
    name: String(v.name ?? ""),
    title: String(v.title ?? ""),
    bio: String(v.bio ?? ""),
    industries: String(v.industries ?? ""),
    website: String(v.website ?? ""),
    featured: Boolean(v.featured),
    speakerMonth: String(v.speakerMonth ?? ""),
    tslsMainSpeaker: Boolean(v.tslsMainSpeaker),
  };
}

/** Headshot controls in a speaker's edit row. */
function HeadshotControls({ row }: { row: EntityRow }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const headshotUrl = String(row.values.headshotUrl ?? "");

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
          Headshot — a square photo looks best (PNG/JPG/WebP, &lt;4 MB)
        </label>
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        {headshotUrl && (
          <img
            src={headshotUrl}
            alt="Current headshot"
            style={{
              width: 64,
              height: 64,
              objectFit: "cover",
              borderRadius: "50%",
              border: "1px solid var(--warm-gray)",
            }}
          />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          ref={fileRef}
          style={{ fontSize: 12 }}
          aria-label="Headshot file"
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
            run(() => uploadSpeakerHeadshot(row.id, fd));
          }}
        >
          Upload headshot
        </button>
        {headshotUrl && (
          <button
            type="button"
            className="btn-mini danger"
            disabled={pending}
            onClick={() => run(() => removeSpeakerHeadshot(row.id))}
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
      createHint="Headshot upload: after adding the speaker, click Edit on their row — the upload is in the edit panel."
      renderRowExtras={(row) => <HeadshotControls row={row} />}
      onCreate={(v) => createSpeaker(toInput(v))}
      onUpdate={(id, v) => updateSpeaker(id, toInput(v))}
      onDelete={(id) => deleteSpeaker(id)}
    />
  );
}
