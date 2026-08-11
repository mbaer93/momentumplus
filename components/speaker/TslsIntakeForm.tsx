"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTslsIntake } from "@/app/(portal)/speaker/tsls-intake/actions";
import {
  TSLS_INTAKE_INTRO,
  TSLS_INTAKE_SECTIONS,
  TSLS_INTAKE_TITLE,
  missingTslsAnswers,
  pruneHiddenAnswers,
  tslsFieldVisible,
  type TslsAnswers,
  type TslsField,
} from "@/lib/tsls-intake";

/*
 * The TSLS Speaker Tech Questionnaire.
 *
 * Sierra's wording throughout — questions, options and notices all come from
 * lib/tsls-intake.ts and are rendered as-is. The only text this component
 * adds is the save/submit controls and the missing-answers hint.
 *
 * Answers live in one map keyed by question, because a dozen of these
 * questions reveal or hide others and the conditional logic has to be able
 * to read across the whole form.
 */

export function TslsIntakeForm({
  initialAnswers,
  initialSignedName,
  initialSignedDate,
  submittedAtLabel,
  updatedAtLabel,
  readOnly = false,
  previewAs = null,
}: {
  initialAnswers: TslsAnswers;
  initialSignedName: string;
  initialSignedDate: string;
  submittedAtLabel: string | null;
  updatedAtLabel: string | null;
  readOnly?: boolean;
  previewAs?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<TslsAnswers>(initialAnswers);
  const [signedName, setSignedName] = useState(initialSignedName);
  const [signedDate, setSignedDate] = useState(initialSignedDate);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const withSignature: TslsAnswers = {
    ...answers,
    ...(signedName.trim() ? { signature: signedName } : {}),
    ...(signedDate ? { signatureDate: signedDate } : {}),
  };
  const stillMissing = missingTslsAnswers(withSignature);

  function setAnswer(key: string, value: string | string[]) {
    setAnswers((prev) => {
      const next = { ...prev, [key]: value };
      // Changing a trigger can hide follow-ups; drop their stale answers
      // straight away so what's on screen is what will be saved.
      return pruneHiddenAnswers(next);
    });
    setMsg(null);
  }

  function toggleCheckbox(key: string, option: string, checked: boolean) {
    const current = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
    setAnswer(
      key,
      checked ? [...current, option] : current.filter((v) => v !== option),
    );
  }

  function save(intent: "draft" | "submit") {
    setMsg(null);
    setMissing([]);
    start(async () => {
      const res = await saveTslsIntake(
        { answers, signedName, signedDate },
        intent,
      );
      setMsg({ ok: res.ok, text: res.message ?? "" });
      setMissing(res.missing ?? []);
      if (res.ok) router.refresh();
    });
  }

  function Field({ field }: { field: TslsField }) {
    if (!tslsFieldVisible(field, withSignature)) return null;
    const value = answers[field.key];
    const asText = typeof value === "string" ? value : "";
    const label = (
      <label htmlFor={field.key}>
        {field.label}
        {field.required && <span className="tsls-required"> *</span>}
      </label>
    );

    if (field.kind === "radio" || field.kind === "acknowledgement") {
      return (
        <div className="admin-field">
          <span className="tsls-question">
            {field.label}
            {field.required && <span className="tsls-required"> *</span>}
          </span>
          <div
            className={
              field.kind === "acknowledgement" ? "tsls-ack" : "tsls-options"
            }
          >
            {(field.options ?? []).map((option) => (
              <label key={option} className="tsls-choice">
                <input
                  type="radio"
                  name={field.key}
                  checked={asText === option}
                  disabled={readOnly}
                  onChange={() => setAnswer(field.key, option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    if (field.kind === "checkbox") {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="admin-field">
          <span className="tsls-question">
            {field.label}
            {field.required && <span className="tsls-required"> *</span>}
          </span>
          <div className="tsls-checklist">
            {(field.options ?? []).map((option) => (
              <label key={option} className="tsls-choice">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  disabled={readOnly}
                  onChange={(e) =>
                    toggleCheckbox(field.key, option, e.target.checked)
                  }
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    if (field.kind === "select") {
      return (
        <div className="admin-field">
          {label}
          <select
            id={field.key}
            value={asText}
            disabled={readOnly}
            onChange={(e) => setAnswer(field.key, e.target.value)}
          >
            <option value="">Please Select</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.kind === "textarea") {
      return (
        <div className="admin-field">
          {label}
          <textarea
            id={field.key}
            value={asText}
            disabled={readOnly}
            onChange={(e) => setAnswer(field.key, e.target.value)}
          />
        </div>
      );
    }

    if (field.kind === "signature") {
      return (
        <div className="admin-field" style={{ maxWidth: 420 }}>
          <label htmlFor="signature">
            Signature — type your full name
            <span className="tsls-required"> *</span>
          </label>
          <input
            id="signature"
            className="tsls-signature"
            value={signedName}
            disabled={readOnly}
            autoComplete="off"
            onChange={(e) => {
              setSignedName(e.target.value);
              setMsg(null);
            }}
          />
        </div>
      );
    }

    if (field.kind === "date") {
      return (
        <div className="admin-field" style={{ maxWidth: 260 }}>
          {label}
          <input
            id={field.key}
            type="date"
            value={signedDate}
            disabled={readOnly}
            onChange={(e) => {
              setSignedDate(e.target.value);
              setMsg(null);
            }}
          />
        </div>
      );
    }

    return (
      <div className="admin-field">
        {label}
        <input
          id={field.key}
          type={field.kind === "email" ? "email" : field.kind === "tel" ? "tel" : "text"}
          value={asText}
          disabled={readOnly}
          onChange={(e) => setAnswer(field.key, e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="admin-pad tsls-intake">
      <div className="section-header">
        <div>
          <h2>{TSLS_INTAKE_TITLE}</h2>
          <p>Tri-State Leadership Summit · October 14, 2026 · The Maryland Theatre</p>
        </div>
      </div>

      <div className="admin-hint">{TSLS_INTAKE_INTRO}</div>

      {previewAs && (
        <div className="admin-hint">
          Viewing {previewAs}&apos;s questionnaire. Read-only — only the speaker
          can change their answers.
        </div>
      )}

      {!previewAs && submittedAtLabel && (
        <div className="admin-hint">
          Submitted {submittedAtLabel}
          {updatedAtLabel && updatedAtLabel !== submittedAtLabel
            ? ` · last updated ${updatedAtLabel}`
            : ""}
          . Change anything you like — your answers save over the top.
        </div>
      )}

      {TSLS_INTAKE_SECTIONS.map((section) => (
        <section key={section.title} className="admin-form" style={{ maxWidth: "none" }}>
          <h3 className="tsls-h">{section.title}</h3>
          {(section.notices ?? []).map((notice, i) => (
            <p key={i} className="tsls-notice">
              {notice.text}
            </p>
          ))}
          {section.fields.map((field) => (
            <Field key={field.key} field={field} />
          ))}
        </section>
      ))}

      {!readOnly && (
        <div className="admin-form" style={{ maxWidth: "none" }}>
          {stillMissing.length > 0 && (
            <div className="tsls-missing">
              {stillMissing.length} required question
              {stillMissing.length === 1 ? "" : "s"} still to answer — you can
              save a draft now and finish later.
            </div>
          )}
          {msg && (
            <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
              {msg.text}
              {missing.length > 0 && (
                <ul className="tsls-missing-list">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-mini"
              disabled={pending}
              onClick={() => save("draft")}
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || stillMissing.length > 0}
              onClick={() => save("submit")}
            >
              {submittedAtLabel ? "Save changes" : "Submit questionnaire"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
