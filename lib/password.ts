/*
 * Password policy — NIST SP 800-63B rev 4 (Matt, 2026-08-19).
 *
 * Twelve characters, no composition rules, plus the HaveIBeenPwned leaked
 * password check (enforced server-side by Supabase, Attack Protection →
 * Email provider). This must stay in step with the Supabase dashboard
 * setting: minimum length 12, required characters "No required characters".
 * If the two disagree, the screen promises something the server refuses —
 * which is the exact class of bug that cost us most of August.
 *
 * WHY THE CHARACTER-CLASS RULES ARE GONE. Rev 4 does not merely stop
 * recommending them, it prohibits them. Requiring an uppercase, a digit and
 * a symbol reliably produces "Password1!" and its cousins: a predictable
 * transformation that adds almost no real entropy while adding enough
 * friction that people reuse one password everywhere. Length and breach
 * screening do the work those rules were pretending to do.
 *
 * WHY 12 AND NOT 15. Rev 4 recommends 15 for password-only accounts. We
 * went one step short deliberately: the members are typing on phones, often
 * without a password manager, and a month of sign-in failures has already
 * shown what friction on this path costs. Twelve with no composition rules
 * and breach screening is comfortably stronger than the old eight-with-four
 * classes. Raising it to 15 later is a one-line change here plus the
 * dashboard — and it only ever applies to new passwords, since Supabase
 * checks the policy at set-time.
 *
 * ONE LIST, two uses (Rob, via Matt, 2026-08-19: a strength meter, "instead
 * of putting in a password and hitting the save button and getting an error
 * message"). checkPassword answers "is this allowed" for the submit;
 * PASSWORD_RULES is the same rules as a checklist the field shows live.
 * Generated from one array so the screen can never promise something the
 * save then refuses.
 */

/** The floor. Mirror any change in the Supabase dashboard. */
export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  /** Shown in the live checklist — short, because they sit in a row. */
  label: string;
  test: (pw: string) => boolean;
  /** Shown on submit, phrased as the thing to do next. */
  error: string;
  /**
   * Optional 0–1 partial credit for the meter. A length rule is the one
   * kind that a member is genuinely part-way through, and a bar that sits
   * at empty until it snaps to full tells them nothing while they type.
   */
  progress?: (pw: string) => number;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    label: `${PASSWORD_MIN_LENGTH}+ characters`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
    error: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    progress: (pw) => Math.min(pw.length / PASSWORD_MIN_LENGTH, 1),
  },
];

/*
 * Copy note for Matt: this is the one place the policy speaks to a member,
 * and it now has to do a job the old hint did not. Removing the character
 * rules without saying anything would read as "we lowered the bar", when
 * the bar went up. So it names the thing that actually works.
 */
export const PASSWORD_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters. A phrase you'll remember — three or ` +
  `four unrelated words — is both easier to type and harder to guess than a ` +
  `short complicated one.`;

/** Returns an error message if the password fails the policy, else null. */
export function checkPassword(pw: string): string | null {
  return PASSWORD_RULES.find((r) => !r.test(pw))?.error ?? null;
}

/**
 * How far along the meter should sit, 0–1. Rules with partial credit
 * contribute it; the rest are all-or-nothing.
 */
export function passwordProgress(pw: string): number {
  const total = PASSWORD_RULES.reduce(
    (sum, r) => sum + (r.test(pw) ? 1 : (r.progress?.(pw) ?? 0)),
    0,
  );
  return total / PASSWORD_RULES.length;
}
