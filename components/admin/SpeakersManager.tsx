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
  inviteSpeakerListing,
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
    key: "contactEmail",
    label: "Email (for login invites — pulled from TSLS when available)",
    type: "text",
    placeholder: "speaker@example.com",
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
  /* Admin-only, and deliberately separate from TSLS Main Speaker above:
     that flag says what someone IS (and the TSLS pull sets it itself),
     this one is Matt's decision about one speaker. Default on, so every
     existing speaker keeps the payment feature until it's turned off. */
  {
    key: "paymentAccess",
    label: "Payment access",
    type: "checkbox",
    hint: "On: this speaker sees their earnings in Speaker Studio and appears with their 15% share in the month table. Off: every payment figure is hidden from them and no share is calculated — they keep their speaker page, sessions, and member count. Only an admin can change this; speakers can't set it themselves.",
  },
  /* The escape hatch for the agreement gate. TSLS Main Speakers are already
     exempt without it — this is for an Advisor who signed on paper, or
     someone who isn't an Advisor at all. */
  {
    key: "advisorAgreementWaived",
    label: "Waive the Leadership Advisor Agreement",
    type: "checkbox",
    hint: "Off (normal): this Advisor must sign the Momentum+ Leadership Advisor Agreement in the app before Speaker Studio opens to them. On: they skip the signature — use this only when the agreement is already signed elsewhere, or the person isn't a Leadership Advisor. TSLS Main Speakers never see the agreement and don't need this.",
  },
];

const EMPTY: EntityValues = {
  name: "",
  title: "",
  industries: "",
  contactEmail: "",
  website: "",
  bio: "",
  featured: false,
  speakerMonth: "",
  tslsMainSpeaker: false,
  // New speakers get payment access; it is switched off case by case.
  paymentAccess: true,
  // Nobody is waived until an admin says so.
  advisorAgreementWaived: false,
};

function toInput(v: EntityValues): SpeakerInput {
  return {
    name: String(v.name ?? ""),
    title: String(v.title ?? ""),
    bio: String(v.bio ?? ""),
    industries: String(v.industries ?? ""),
    contactEmail: String(v.contactEmail ?? ""),
    website: String(v.website ?? ""),
    featured: Boolean(v.featured),
    speakerMonth: String(v.speakerMonth ?? ""),
    tslsMainSpeaker: Boolean(v.tslsMainSpeaker),
    // Defensive: an absent value means the switch was never rendered (or the
    // row predates the field), which is "has access", not "take it away".
    paymentAccess: v.paymentAccess !== false,
    // The mirror image: an absent value is "not waived", so a missing switch
    // can never quietly drop the signature requirement.
    advisorAgreementWaived: v.advisorAgreementWaived === true,
  };
}

/** Login-invite controls in a speaker's edit row (Matt, 2026-08-05):
    login info goes out only when an admin clicks — here for one speaker,
    or the header button for everyone at once. */
function InviteControls({ row }: { row: EntityRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loginLink, setLoginLink] = useState<string | null>(null);

  const email = String(row.values.contactEmail ?? "").trim();
  const hasAccount = Boolean(row.values.hasAccount);
  const invitePending = Boolean(row.values.invitePending);
  // Empty in preview mode (placeholder speakers carry no agreement state).
  const agreementStatus = String(row.values.agreementStatus ?? "").trim();
  const intakeStatus = String(row.values.intakeStatus ?? "").trim();
  // A main speaker's intake lives in Jotform — there's nothing to open here.
  const isMainSpeaker = Boolean(row.values.isMainSpeaker);

  const state = hasAccount
    ? "Has a Momentum+ login."
    : invitePending
      ? "Invite pending — they haven't finished setup yet."
      : email
        ? "No login yet."
        : "No login yet — add an email above (and Save) to invite them.";

  return (
    <div style={{ marginTop: 12 }}>
      <div className="admin-field" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 13 }}>
          Login invite — {state}
        </label>
      </div>
      <div className="admin-form-actions" style={{ marginTop: 0, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-mini"
          disabled={pending || !email || hasAccount}
          onClick={() => {
            setMsg(null);
            setLoginLink(null);
            startTransition(async () => {
              try {
                const res = await inviteSpeakerListing(row.id);
                setMsg(res.message ? { text: res.message, ok: res.ok } : null);
                setLoginLink(res.loginLink ?? null);
                if (res.ok) router.refresh();
              } catch {
                setMsg({
                  text: "That didn't send — refresh this page and try again (the app may have just been updated).",
                  ok: false,
                });
              }
            });
          }}
        >
          {pending
            ? "Sending…"
            : invitePending
              ? "Re-send login invite"
              : "Send login invite"}
        </button>
        {hasAccount && (
          <span style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
            Already set up — nothing to send.
          </span>
        )}
      </div>
      {agreementStatus && (
        <div style={{ marginTop: 14 }}>
          <div className="admin-field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 13 }}>
              Leadership Advisor Agreement — {agreementStatus}
            </label>
          </div>
          <a className="btn-mini" href={`/speaker/agreement?as=${row.id}`}>
            Open their agreement
          </a>
        </div>
      )}
      {intakeStatus && (
        <div style={{ marginTop: 14 }}>
          <div className="admin-field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 13 }}>
              Session intake — {intakeStatus}
            </label>
          </div>
          {!isMainSpeaker && (
            <a className="btn-mini" href={`/speaker/intake?as=${row.id}`}>
              Open their intake
            </a>
          )}
        </div>
      )}
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginTop: 6 }}
        >
          {msg.text}
        </div>
      )}
      {loginLink && (
        <div className="admin-form-msg ok" style={{ marginTop: 6, wordBreak: "break-all" }}>
          Sign-in link: {loginLink}
        </div>
      )}
    </div>
  );
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
      renderRowExtras={(row) => (
        <>
          <HeadshotControls row={row} />
          <InviteControls row={row} />
        </>
      )}
      onCreate={(v) => createSpeaker(toInput(v))}
      onUpdate={(id, v) => updateSpeaker(id, toInput(v))}
      onDelete={(id) => deleteSpeaker(id)}
    />
  );
}
