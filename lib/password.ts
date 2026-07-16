/*
 * Password policy — mirrors the Supabase Auth settings (Attack Protection →
 * Email provider): 8+ chars with a lowercase letter, an uppercase letter, a
 * digit, and a symbol, plus the HaveIBeenPwned leaked-password check (that
 * one is enforced only server-side by Supabase). Keeping the rule here lets
 * the UI tell members the requirement up front instead of bouncing them
 * after submit.
 */

export const PASSWORD_HINT =
  "At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.";

/** Returns an error message if the password fails the policy, else null. */
export function checkPassword(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(pw)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Add a symbol (like ! ? # or $).";
  return null;
}
