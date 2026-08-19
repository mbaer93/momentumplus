/*
 * The Momentum+ guide — how to get the most out of the membership.
 *
 * Twelve steps in three groups, replacing the four-step first-run tour. The
 * old version only covered "find your way around" and then vanished; this
 * one keeps going into the things members actually pay for.
 *
 * COPY IS DRAFT (Matt, 2026-08-18) — it all lives here so rewriting it is
 * an edit to one file rather than a hunt through JSX.
 *
 * Two kinds of step:
 *
 *   verified  the server knows whether it happened (an enrollment exists, a
 *             note has words in it). These cannot be faked by visiting a
 *             page, and they tick themselves for members who did the thing
 *             before the guide ever existed.
 *   visit     going there IS the step ("meet the members"). Recorded per
 *             device in localStorage, because there is nothing to record
 *             server-side and inventing a table for "opened a page" would
 *             cost more than it is worth.
 */

export type GuideGroupKey = "setup" | "habit" | "deeper";

export interface GuideGroupDef {
  key: GuideGroupKey;
  /** DRAFT. */
  label: string;
}

export const GUIDE_GROUPS: GuideGroupDef[] = [
  { key: "setup", label: "Get set up" },
  { key: "habit", label: "Make it a habit" },
  { key: "deeper", label: "Go deeper" },
];

/** Server-checked facts about this member, for the `verified` steps. */
export interface GuideFacts {
  enrolled: boolean;
  prefsSaved: boolean;
  profileFilled: boolean;
  attended: boolean;
  wroteNote: boolean;
  heardEpisode: boolean;
}

export interface GuideStepDef {
  key: string;
  group: GuideGroupKey;
  /** DRAFT. */
  title: string;
  /** DRAFT. Shown when this is the member's current step. */
  description: string;
  href: string;
  /** DRAFT. */
  cta: string;
  /** Reads the server fact for this step, or null when it's a visit step. */
  verifiedBy: ((facts: GuideFacts) => boolean) | null;
}

export const GUIDE_STEPS: GuideStepDef[] = [
  {
    key: "enroll",
    group: "setup",
    title: "Enroll in your first session",
    description:
      "Live sessions are the heart of Momentum+. Pick one that fits your calendar — you'll get a reminder before it starts, and the room opens right here.",
    href: "/sessions",
    cta: "Browse sessions",
    verifiedBy: (f) => f.enrolled,
  },
  {
    key: "profile",
    group: "setup",
    title: "Finish your profile",
    description:
      "Your name, title and company are what other members see in the directory and in chat. It takes a minute and makes every introduction easier.",
    href: "/profile",
    cta: "Complete my profile",
    verifiedBy: (f) => f.profileFilled,
  },
  {
    key: "prefs",
    group: "setup",
    title: "Choose how we keep you posted",
    description:
      "Session reminders, new recordings, community replies. Email and in-app are on by default; text messages only if you opt in.",
    href: "/profile",
    cta: "Set my preferences",
    verifiedBy: (f) => f.prefsSaved,
  },
  {
    key: "community",
    group: "setup",
    title: "Say hello in the Community",
    description:
      "Introduce yourself in #general — who you are, what you do, what you're working on.",
    href: "/community",
    cta: "Open the Community",
    verifiedBy: null,
  },
  {
    key: "attend",
    group: "habit",
    title: "Show up live",
    description:
      "Watching later is good. Being in the room is better — you can ask your own question and get an answer on the spot.",
    href: "/sessions",
    cta: "Find one to attend",
    // Attendance arrives from Zoom AFTER the session, so this ticks later
    // that day rather than the moment they join.
    verifiedBy: (f) => f.attended,
  },
  {
    key: "notes",
    group: "habit",
    title: "Take notes during a session",
    description:
      "Your notes are private, saved against the session, and waiting for you in your profile a year later.",
    href: "/sessions",
    cta: "Open a session",
    verifiedBy: (f) => f.wroteNote,
  },
  {
    key: "calendar",
    group: "habit",
    title: "Add the calendar feed",
    description:
      "Subscribe once and every session you enroll in lands in your own calendar automatically.",
    href: "/calendar",
    cta: "Open the Calendar",
    verifiedBy: null,
  },
  {
    key: "library",
    group: "habit",
    title: "Catch up in the Library",
    description:
      "Every session is recorded, with AI takeaways and your notes attached. Miss one and nothing is lost.",
    href: "/library",
    cta: "Browse the Library",
    verifiedBy: null,
  },
  {
    key: "podcast",
    group: "deeper",
    title: "Listen to a Branching Out episode",
    description:
      "The podcast runs all year between sessions — short, practical, and it counts toward your record.",
    href: "/branching-out",
    cta: "Open Branching Out",
    verifiedBy: (f) => f.heardEpisode,
  },
  /*
   * "Finish a course and earn the certificate" lived here (Matt, 2026-08-19:
   * remove it). Education is hidden for now, so the step pointed members at
   * a section they cannot reach — a checklist item nobody can tick reads as
   * broken, not aspirational. Bring it back when Education is unhidden: it
   * belongs in the "deeper" group, links to /education, and is verified by a
   * FINISHED course (every lesson complete), not a started one.
   */
  {
    key: "members",
    group: "deeper",
    title: "Meet the members",
    description:
      "The directory is the point of a community. Find three people worth knowing and reach out to one.",
    href: "/members",
    cta: "Open the directory",
    verifiedBy: null,
  },
  {
    key: "resources",
    group: "deeper",
    title: "Use a member resource",
    description:
      "Partner offers, speaker businesses, and tools shared by the community.",
    href: "/resources",
    cta: "Browse resources",
    verifiedBy: null,
  },
];

/**
 * Is this step done?
 *
 * A verified step counts if the SERVER says so OR the member has visited it
 * — visiting is what the old tour recorded, and demoting someone's finished
 * step back to unfinished because the server hasn't caught up yet would be
 * worse than a step that ticks slightly early.
 */
export function stepDone(
  step: GuideStepDef,
  facts: GuideFacts,
  visited: Set<string>,
): boolean {
  if (step.verifiedBy?.(facts)) return true;
  return visited.has(step.key);
}

export function groupProgress(
  group: GuideGroupKey,
  facts: GuideFacts,
  visited: Set<string>,
): { done: number; total: number } {
  const steps = GUIDE_STEPS.filter((s) => s.group === group);
  return {
    done: steps.filter((s) => stepDone(s, facts, visited)).length,
    total: steps.length,
  };
}

/** The next unfinished step, or null when the member has done everything. */
export function currentStep(
  facts: GuideFacts,
  visited: Set<string>,
): GuideStepDef | null {
  return GUIDE_STEPS.find((s) => !stepDone(s, facts, visited)) ?? null;
}
