"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgreementDoc } from "@/lib/advisor-agreement";
import {
  discardAgreementDraft,
  publishAgreementDraft,
  requireResignature,
  requireSpeakerResignature,
  saveAgreementDraft,
  saveSpeakerOverride,
  type EditorResult,
} from "@/app/(portal)/admin/agreement/actions";
import { describeChanges, type AgreementChange } from "@/lib/agreement-diff";

/*
 * Editing the Leadership Advisor Agreement before it goes to an Advisor.
 *
 * REWORDING, NOT RESTRUCTURING (Matt's call, 2026-08-11). Every section and
 * every block renders as its own box: the shape is fixed and comes from the
 * server, so this screen cannot add a clause, delete one, or renumber the
 * document. That is deliberate — §6 drives the Advisor intake's checklist
 * and §14 the earnings split, and both are referenced BY NUMBER.
 *
 * A bullet list edits as one box, one bullet per line, because that is how
 * people actually retype a list.
 */

export interface AgreementEditorProps {
  doc: AgreementDoc;
  /** Master mode: the draft's version name, if a draft is open. */
  draftVersion?: string | null;
  /** Master mode: the version currently in force. */
  publishedVersion?: string | null;
  /** Master mode: what publishing this draft would change. */
  changes?: AgreementChange[];
  /** Override mode: whose copy this is. */
  speaker?: { id: string; name: string } | null;
  /** Override mode: which section numbers already differ from the master. */
  overriddenSections?: number[];
  overrideNote?: string;
}

export function AgreementEditor({
  doc,
  draftVersion = null,
  publishedVersion = null,
  changes = [],
  speaker = null,
  overriddenSections = [],
  overrideNote = "",
}: AgreementEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<EditorResult | null>(null);
  const overridden = new Set(overriddenSections);

  function run(action: (fd: FormData) => Promise<EditorResult>, fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await action(fd);
      setMsg(res);
      if (res.ok) router.refresh();
    });
  }

  const isOverride = Boolean(speaker);

  return (
    <form
      className="admin-pad"
      action={(fd) =>
        run(isOverride ? saveSpeakerOverride : saveAgreementDraft, fd)
      }
    >
      {speaker && <input type="hidden" name="speakerId" value={speaker.id} />}

      <div className="section-header">
        <div>
          <h2>
            {isOverride
              ? `${speaker!.name}'s agreement`
              : "Leadership Advisor Agreement"}
          </h2>
          <p>
            {isOverride
              ? "Change only the clauses that differ for this Advisor. Everything you leave alone keeps following the master, so later master edits still reach them."
              : draftVersion
                ? "You have an unpublished draft. Advisors keep seeing the published wording until you publish."
                : "Editing starts a draft. Nobody sees a word of it until you publish."}
          </p>
        </div>
      </div>

      {msg && (
        <div className={msg.ok ? "admin-hint" : "admin-error"}>{msg.message}</div>
      )}

      {!isOverride && (
        <div className="card admin-pad">
          <div className="admin-field">
            <label htmlFor="version">Version name</label>
            <input
              id="version"
              name="version"
              defaultValue={draftVersion ?? ""}
              placeholder="2026-09-01"
              disabled={pending}
            />
            <p className="admin-field-hint">
              How this wording is filed on every signature made against it.
              {publishedVersion
                ? ` In force now: ${publishedVersion}.`
                : " Nothing published yet — Advisors currently see the wording Momentum+ ships with."}
            </p>
          </div>
        </div>
      )}

      {isOverride && (
        <div className="card admin-pad">
          <div className="admin-field">
            <label htmlFor="note">Why this copy differs (internal note)</label>
            <input
              id="note"
              name="note"
              defaultValue={overrideNote}
              placeholder="Agreed a different featured-month commitment"
              disabled={pending}
            />
            <p className="admin-field-hint">
              Never shown to the Advisor — it is here so the next person can
              tell why their terms are not the standard ones.
            </p>
          </div>
        </div>
      )}

      <div className="card admin-pad">
        <div className="admin-field">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" defaultValue={doc.title} disabled={pending} />
        </div>
        <div className="admin-field">
          <label htmlFor="preamble">Preamble</label>
          <textarea
            id="preamble"
            name="preamble"
            rows={3}
            defaultValue={doc.preamble}
            disabled={pending}
          />
        </div>
      </div>

      {doc.sections.map((section) => (
        <div className="card admin-pad" key={section.n}>
          <div className="admin-field">
            <label htmlFor={`s${section.n}.title`}>
              §{section.n}
              {overridden.has(section.n) ? " — tailored for this Advisor" : ""}
            </label>
            <input
              id={`s${section.n}.title`}
              name={`s${section.n}.title`}
              defaultValue={section.title}
              disabled={pending}
            />
          </div>
          {section.blocks.map((block, i) => (
            <div className="admin-field" key={i}>
              <label htmlFor={`s${section.n}.b${i}`}>
                {block.kind === "ul"
                  ? "List — one item per line"
                  : block.kind === "strong"
                    ? "Bold paragraph"
                    : block.kind === "sub"
                      ? "Sub-heading"
                      : "Paragraph"}
              </label>
              <textarea
                id={`s${section.n}.b${i}`}
                name={`s${section.n}.b${i}`}
                rows={block.kind === "ul" ? Math.min(12, block.items.length + 1) : 3}
                defaultValue={
                  block.kind === "ul" ? block.items.join("\n") : block.text
                }
                disabled={pending}
              />
            </div>
          ))}
        </div>
      ))}

      <div className="card admin-pad">
        <div className="admin-field">
          <label htmlFor="acceptance">§34 Acceptance</label>
          <textarea
            id="acceptance"
            name="acceptance"
            rows={3}
            defaultValue={doc.acceptance}
            disabled={pending}
          />
        </div>
      </div>

      {/*
       * What publishing would actually change. This is legal wording and §32
       * needs both parties to agree to a material amendment, so the whole
       * clause is shown before and after rather than a word-level highlight —
       * a contract diff that invites skimming is worse than none.
       */}
      {!isOverride && draftVersion && (
        <div className="card admin-pad">
          <h3>Changes against the published wording</h3>
          {changes.length === 0 ? (
            <p className="admin-field-hint">
              This draft says exactly what the published version says. There is
              nothing to publish — a new version number on identical wording
              only makes the signature ledger harder to read.
            </p>
          ) : (
            <>
              <p className="admin-field-hint">{describeChanges(changes)}.</p>
              {changes.map((c) => (
                <div className="admin-field" key={`${c.kind}-${c.n ?? c.label}`}>
                  <label>
                    {c.label}
                    {c.headingChanged ? " (heading changed)" : ""}
                  </label>
                  <div className="agreement-diff">
                    <div className="agreement-diff-side">
                      <span className="admin-field-hint">Published</span>
                      <pre>{c.before || "(empty)"}</pre>
                    </div>
                    <div className="agreement-diff-side">
                      <span className="admin-field-hint">Draft</span>
                      <pre>{c.after || "(empty)"}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="prefs-save-row">
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : isOverride
              ? "Save this Advisor's copy"
              : "Save draft"}
        </button>
        {!isOverride && draftVersion && (
          <>
            <button
              className="btn-secondary"
              type="submit"
              disabled={pending || changes.length === 0}
              formAction={(fd) => run(publishAgreementDraft, fd)}
            >
              Publish draft
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={pending}
              onClick={() => run(() => discardAgreementDraft(), new FormData())}
            >
              Discard draft
            </button>
          </>
        )}
      </div>

      <p className="admin-field-hint">
        Publishing never asks anyone to sign again. Existing signatures keep
        counting until you deliberately amend the terms below.
      </p>
    </form>
  );
}

/*
 * §32's material amendment, as its own act.
 *
 * Deliberately NOT a checkbox on the publish form: it was the most
 * consequential control on the screen and the easiest to trip by accident
 * (Matt, 2026-08-11). It states how many people it would send back, and it
 * takes a typed confirmation, because clearing it afterwards would silently
 * reinstate signatures those people were already told no longer stood.
 *
 * Its own <form>, outside the editor's, so submitting it can never carry the
 * draft's text along with it.
 */
export function RequireResignatureCard({
  affectedCount,
  speaker = null,
}: {
  affectedCount: number;
  speaker?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<EditorResult | null>(null);

  const who = speaker
    ? `${speaker.name} currently holds a signature that counts.`
    : affectedCount === 0
      ? "No Advisor currently holds a signature that counts, so this would send nobody back today."
      : `${affectedCount} ${affectedCount === 1 ? "Advisor holds" : "Advisors hold"} a signature that counts. ${affectedCount === 1 ? "They" : "They"} would be sent back to the agreement before Speaker Studio opens.`;

  return (
    <form
      className="admin-pad"
      action={(fd) => {
        setMsg(null);
        start(async () => {
          const res = await (speaker
            ? requireSpeakerResignature(fd)
            : requireResignature(fd));
          setMsg(res);
          if (res.ok) router.refresh();
        });
      }}
    >
      {speaker && <input type="hidden" name="speakerId" value={speaker.id} />}
      <div className="card admin-pad">
        <h3>Ask {speaker ? "this Advisor" : "Advisors"} to sign again</h3>
        <p className="admin-field-hint">{who}</p>
        <p className="admin-field-hint">
          §32 requires a material amendment to be agreed by both parties. Use
          this when the terms changed — not for a typo or a formatting fix.
        </p>
        {msg && (
          <div className={msg.ok ? "admin-hint" : "admin-error"}>
            {msg.message}
          </div>
        )}
        <div className="admin-field">
          <label htmlFor={`confirm-${speaker?.id ?? "master"}`}>
            Type SIGN AGAIN to confirm
          </label>
          <input
            id={`confirm-${speaker?.id ?? "master"}`}
            name="confirm"
            autoComplete="off"
            placeholder="SIGN AGAIN"
            disabled={pending}
          />
        </div>
        <button className="btn-secondary" type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record the amendment"}
        </button>
      </div>
    </form>
  );
}
