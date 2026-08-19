/*
 * Password policy — mirrors the Supabase Auth settings (Attack Protection →
 * Email provider): 8+ chars with a lowercase letter, an uppercase letter, a
 * digit, and a symbol, plus the HaveIBeenPwned leaked-password check (that
 * one is enforced only server-side by Supabase). Keeping the rule here lets
 * the UI tell members the requirement up front instead of bouncing them
 * after submit.
 *
 * ONE LIST, two uses (Rob, via Matt, 2026-08-19: a strength meter, "instead
 * of putting in a password and hitting the save button and getting an error
 * message"). checkPassword answers "is this allowed" for the submit;
 * PASSWORD_RULES is the same rules as a checklist the field can show live.
 * They are generated from the same array so the screen can never promise
 * something the save then refuses.
 */

export interface PasswordRule {
  /** Shown in the live checklist — short, because they sit in a row. */
  label: string;
  test: (pw: string) => boolean;
  /** Shown on submit, phrased as the thing to do next. */
  error: string;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    label: "8+ characters",
    test: (pw) => pw.length >= 8,
    error: "Use at least 8 characters.",
  },
  {
    label: "lowercase",
    test: (pw) => /[a-z]/.test(pw),
    error: "Add a lowercase letter.",
  },
  {
    label: "uppercase",
    test: (pw) => /[A-Z]/.test(pw),
    error: "Add an uppercase letter.",
  },
  {
    label: "number",
    test: (pw) => /[0-9]/.test(pw),
    error: "Add a number.",
  },
  {
    label: "symbol",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
    error: "Add a symbol (like ! ? # or $).",
  },
];

export const PASSWORD_HINT =
  "At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.";

/** Returns an error message if the password fails the policy, else null. */
export function checkPassword(pw: string): string | null {
  return PASSWORD_RULES.find((r) => !r.test(pw))?.error ?? null;
}
