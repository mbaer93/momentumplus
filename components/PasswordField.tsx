"use client";

import { useId, useState } from "react";
import { PASSWORD_RULES } from "@/lib/password";

/*
 * A password box that tells you where you stand while you type (Rob, via
 * Matt, 2026-08-19):
 *
 *   "we usually put a strength meter on there so that the user knows if
 *    they are meeting the criteria instead of putting in a password and
 *    hitting the save button and getting an error message. I also put in
 *    the view password buttons so they can alter the passwords to meet the
 *    criteria on the screen."
 *
 * He is right, and he found it the hard way: the rule was written under the
 * field as a sentence, and the only way to learn you had missed part of it
 * was to submit.
 *
 * The checklist is generated from PASSWORD_RULES — the same list the
 * server checks — so the screen cannot promise something the save then
 * refuses. Nothing here validates; it only shows what the policy already
 * says.
 */

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "new-password",
  /** Show the live checklist. Off for a "confirm" box, which has its own
      one-line answer and does not need the rules twice. */
  showRules = true,
  /** For the confirm box: what it has to match. */
  mustMatch,
  required,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  showRules?: boolean;
  mustMatch?: string;
  required?: boolean;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const [visible, setVisible] = useState(false);

  const results = PASSWORD_RULES.map((r) => ({
    label: r.label,
    met: r.test(value),
  }));
  const metCount = results.filter((r) => r.met).length;
  const allMet = metCount === results.length;

  // Only speak up once there is something to say — an empty box is not a
  // failure, and a wall of red before the first keystroke is hostile.
  const touched = value.length > 0;
  const matches = mustMatch === undefined || value === mustMatch;

  return (
    /* login-field, not admin-field: every use of this is on the dark login
       card, and the admin label colour is near-black — 1.01:1 against that
       ground, which the contrast gate caught before it reached anyone. */
    <div className="login-field">
      <label htmlFor={fieldId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>

      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-describedby={showRules ? `${fieldId}-rules` : undefined}
          style={{ width: "100%", paddingRight: 62 }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // A control that changes what you can see has to say which state
          // it will move you to, not which one you are in.
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          style={{
            position: "absolute",
            right: 8,
            background: "none",
            border: "none",
            color: "var(--gold-light, #D4B87E)",
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            padding: "4px 6px",
          }}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {showRules && (
        <div id={`${fieldId}-rules`} style={{ marginTop: 8 }}>
          {/* The bar is a summary of the checklist below it, not a second
              opinion — it fills as the same rules are met. */}
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.12)",
              overflow: "hidden",
              marginBottom: 8,
            }}
            role="presentation"
          >
            <div
              style={{
                width: `${(metCount / results.length) * 100}%`,
                height: "100%",
                background: allMet
                  ? "var(--accent-green-on-dark, #7FC9A2)"
                  : "var(--gold, #B8965A)",
                transition: "width 140ms linear",
              }}
            />
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 14px",
              fontSize: 12,
            }}
          >
            {results.map((r) => (
              <li
                key={r.label}
                style={{
                  // 8.02:1 on the login card; the brand green is 2.7:1
                  // there and would fail the moment a rule went green.
                  color: r.met
                    ? "var(--accent-green-on-dark, #7FC9A2)"
                    : "var(--mid-gray, #b0a99e)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>
                  {r.met ? "✓" : "·"}
                </span>
                {r.label}
              </li>
            ))}
          </ul>

          {/* One live region, so a screen reader hears progress once rather
              than on every keystroke of every rule. */}
          <p aria-live="polite" className="sr-only">
            {touched
              ? allMet
                ? "Password meets every requirement."
                : `${metCount} of ${results.length} requirements met.`
              : ""}
          </p>
        </div>
      )}

      {mustMatch !== undefined && touched && !matches && (
        <p style={{ fontSize: 12, color: "#E09B9B", margin: "6px 0 0" }}>
          These don&apos;t match yet.
        </p>
      )}
    </div>
  );
}
