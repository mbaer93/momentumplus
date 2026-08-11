"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAdvisorIntake } from "@/app/(portal)/speaker/intake/actions";
import {
  INTAKE_SECTIONS,
  fieldIsVisible,
  missingRequired,
  type AdvisorIntake,
  type IntakeField,
} from "@/lib/advisor-intake";

/*
 * The Advisor session intake form.
 *
 * State is held here rather than left to the DOM because three fields are
 * conditional (§2 slide format, §3 panel conflicts) and the Submit button
 * reports what's still missing as you type — a 20-question form that only
 * tells you what it wants after you press the button is a bad form.
 */

export function AdvisorIntakeForm({
  initial,
  submittedAtLabel,
  updatedAtLabel,
  featuredMonthLabel,
  readOnly = false,
  previewAs = null,
}: {
  initial: AdvisorIntake;
  /** Null until they've handed it in at least once. */
  submittedAtLabel: string | null;
  updatedAtLabel: string | null;
  /** "February 2027", or null when SLC hasn't assigned the month yet. */
  featuredMonthLabel: string | null;
  readOnly?: boolean;
  previewAs?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [intake, setIntake] = useState<AdvisorIntake>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const stillMissing = missingRequired(intake);

  function set<K extends keyof AdvisorIntake>(key: K, value: AdvisorIntake[K]) {
    setIntake((prev) => ({ ...prev, [key]: value }));
    setMsg(null);
  }

  function submit(intent: "draft" | "submit") {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("phone", intake.phone);
    formData.set("website", intake.website);
    formData.set("sessionTitle", intake.sessionTitle);
    formData.set("sessionDescription", intake.sessionDescription);
    formData.set("sessionTakeaways", intake.sessionTakeaways);
    formData.set("preferredSessionDate", intake.preferredSessionDate);
    formData.set("preferredSessionTime", intake.preferredSessionTime);
    for (const item of intake.sessionIncludes) {
      formData.append("sessionIncludes", item);
    }
    formData.set("slidesFormat", intake.slidesFormat);
    formData.set("techNotes", intake.techNotes);
    formData.set("materialsNotes", intake.materialsNotes);
    formData.set("promoNotes", intake.promoNotes);
    formData.set("panelConflictNotes", intake.panelConflictNotes);
    formData.set("additionalNotes", intake.additionalNotes);
    for (const [platform, handle] of Object.entries(intake.socialHandles)) {
      formData.set(`social:${platform}`, handle);
    }
    const triStates: (keyof AdvisorIntake)[] = [
      "usesSlides",
      "needsAv",
      "canJoinEarly",
      "attendingSummit",
      "panelAvailable",
      "podcastInterest",
    ];
    for (const key of triStates) {
      const value = intake[key] as boolean | null;
      formData.set(key, value === true ? "yes" : value === false ? "no" : "");
    }

    setMsg(null);
    setMissing([]);
    start(async () => {
      const res = await saveAdvisorIntake(formData);
      setMsg({ ok: res.ok, text: res.message ?? "" });
      setMissing(res.missing ?? []);
      if (res.ok) router.refresh();
    });
  }

  function Field({ field }: { field: IntakeField }) {
    if (!fieldIsVisible(field, intake)) return null;
    const id = String(field.key);

    if (field.kind === "yesno") {
      const value = intake[field.key] as boolean | null;
      return (
        <div className="admin-field">
          <label>{field.label}</label>
          <div className="intake-yesno">
            {(
              [
                ["Yes", true],
                ["No", false],
              ] as const
            ).map(([text, val]) => (
              <label key={text} className="intake-radio">
                <input
                  type="radio"
                  name={id}
                  checked={value === val}
                  disabled={readOnly}
                  onChange={() => set(field.key, val as AdvisorIntake[typeof field.key])}
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
          {field.help && <div className="intake-help">{field.help}</div>}
        </div>
      );
    }

    if (field.kind === "checklist") {
      const selected = intake[field.key] as string[];
      return (
        <div className="admin-field">
          <label>{field.label}</label>
          <div className="intake-checklist">
            {(field.options ?? []).map((option) => (
              <label key={option} className="intake-radio">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  disabled={readOnly}
                  onChange={(e) =>
                    set(
                      field.key,
                      (e.target.checked
                        ? [...selected, option]
                        : selected.filter((v) => v !== option)) as AdvisorIntake[typeof field.key],
                    )
                  }
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
          {field.help && <div className="intake-help">{field.help}</div>}
        </div>
      );
    }

    if (field.kind === "social") {
      const handles = intake.socialHandles;
      return (
        <div className="admin-field">
          <label>{field.label}</label>
          <div className="intake-social">
            {(field.options ?? []).map((platform) => (
              <div key={platform} className="intake-social-row">
                <span className="intake-social-label">{platform}</span>
                <input
                  value={handles[platform] ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    set("socialHandles", {
                      ...handles,
                      [platform]: e.target.value,
                    })
                  }
                />
              </div>
            ))}
          </div>
          {field.help && <div className="intake-help">{field.help}</div>}
        </div>
      );
    }

    const value = String(intake[field.key] ?? "");
    return (
      <div className="admin-field">
        <label htmlFor={id}>{field.label}</label>
        {field.kind === "textarea" ? (
          <textarea
            id={id}
            value={value}
            disabled={readOnly}
            placeholder={field.placeholder}
            onChange={(e) =>
              set(field.key, e.target.value as AdvisorIntake[typeof field.key])
            }
          />
        ) : (
          <input
            id={id}
            type={field.kind === "date" ? "date" : "text"}
            value={value}
            disabled={readOnly}
            placeholder={field.placeholder}
            onChange={(e) =>
              set(field.key, e.target.value as AdvisorIntake[typeof field.key])
            }
          />
        )}
        {field.help && <div className="intake-help">{field.help}</div>}
      </div>
    );
  }

  return (
    <div className="admin-pad advisor-intake">
      <div className="section-header">
        <div>
          <h2>Session intake</h2>
          <p>
            What the Momentum+ team needs to run your featured session
            {featuredMonthLabel ? ` in ${featuredMonthLabel}` : ""}
          </p>
        </div>
      </div>

      {previewAs && (
        <div className="admin-hint">
          Viewing {previewAs}&apos;s intake. Read-only — only the Advisor can
          change their answers.
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

      {!previewAs && !submittedAtLabel && (
        <div className="admin-hint">
          Save a draft as you go. Nothing is sent to the team until you submit,
          and you can keep editing afterwards.
        </div>
      )}

      {INTAKE_SECTIONS.map((section) => (
        <section key={section.title} className="admin-form" style={{ maxWidth: "none" }}>
          <h3 className="intake-h">{section.title}</h3>
          <p className="intake-intro">{section.intro}</p>
          {section.fields.map((field) => (
            <Field key={String(field.key)} field={field} />
          ))}
        </section>
      ))}

      {!readOnly && (
        <div className="admin-form" style={{ maxWidth: "none" }}>
          {stillMissing.length > 0 && (
            <div className="intake-help">
              Still needed before you can submit:{" "}
              {stillMissing.map((m) => m.label).join(", ")}.
            </div>
          )}
          {msg && (
            <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
              {msg.text}
              {missing.length > 0 && ` (${missing.join(", ")})`}
            </div>
          )}
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-mini"
              disabled={pending}
              onClick={() => submit("draft")}
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || stillMissing.length > 0}
              onClick={() => submit("submit")}
            >
              {submittedAtLabel ? "Save changes" : "Submit intake"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
