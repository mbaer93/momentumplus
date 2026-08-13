/*
 * What a speaker must have on file before the Studio opens.
 *
 * Matt, 2026-08-12: a test speaker reached the Studio — and a public speaker
 * page, and Pro-equivalent portal access — having filled in nothing but a
 * name. The onboarding form marked only first and last name as required, and
 * the server validated only that the name had two words. Everything else was
 * optional, so an empty page shipped.
 *
 * Every field here is required (Matt's call: "all of it"). The Leadership
 * Advisor Agreement is the other half of the gate and is enforced separately
 * in lib/advisor-agreement.ts — a contract belongs on its own page, not
 * buried in a profile form.
 *
 * One function, used by BOTH the onboarding action and the Studio gate, so
 * "complete" cannot come to mean two different things. The UI's `required`
 * attributes are a convenience, not the gate: they are trivially bypassed,
 * and the server is what actually decides.
 */

export interface SpeakerProfileFields {
  name: string | null;
  title: string | null;
  bio: string | null;
  industries: string[] | null;
  /** From the speaker's business resource row (speakers.resource_id). */
  businessName: string | null;
  businessDescription: string | null;
  businessUrl: string | null;
  /** From their profiles row. */
  phone: string | null;
}

function blank(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

/**
 * Human-readable labels for what is still missing, in the order the
 * onboarding form asks for them. Empty array means complete.
 *
 * Labels, not field names: this list is shown to the speaker, so it has to
 * read like the form they are looking at.
 */
export function missingSpeakerFields(f: SpeakerProfileFields): string[] {
  const missing: string[] = [];
  // First AND last name — the same rule members and sponsors are held to.
  if (blank(f.name) || f.name!.trim().split(/\s+/).length < 2) {
    missing.push("your first and last name");
  }
  if (blank(f.title)) missing.push("your title");
  if (blank(f.bio)) missing.push("your bio");
  if (!f.industries || f.industries.filter((t) => t.trim()).length === 0) {
    missing.push("at least one topic");
  }
  if (blank(f.businessName)) missing.push("your business name");
  if (blank(f.businessDescription)) missing.push("a business description");
  if (blank(f.businessUrl)) missing.push("your business website");
  if (blank(f.phone)) missing.push("a phone number");
  return missing;
}

/** One sentence naming what is missing, for a form error or a gate notice. */
export function missingFieldsSentence(missing: string[]): string {
  if (missing.length === 0) return "";
  if (missing.length === 1) return `Please add ${missing[0]}.`;
  const last = missing[missing.length - 1];
  return `Please add ${missing.slice(0, -1).join(", ")} and ${last}.`;
}
