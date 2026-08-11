/*
 * Leadership Advisor session intake.
 *
 * What SLC still needs from an Advisor once they've signed: the session, the
 * materials, the tech, the promo assets. Every question here traces to a
 * clause of the Leadership Advisor Agreement — nothing is invented, and the
 * §-reference on each field is the reason it's being asked.
 *
 * This is NOT the TSLS "Speaker Tech Questionnaire" (Jotform 250896885391071).
 * That one covers the mainstage at The Maryland Theatre — dressing rooms,
 * lapel mics, stage props, call times — and keeps its own submissions. Every
 * Advisor question below is about the VIRTUAL featured session under §6.
 *
 * The field list is data so the form and the admin read-out render from one
 * source: an admin can never be looking at a question the Advisor wasn't
 * asked.
 */

/** The eight-item list in §6, verbatim and in the document's order. */
export const SESSION_INCLUDES_OPTIONS = [
  "Educational presentation",
  "Frameworks or tools",
  "Practical strategies",
  "Guided reflection",
  "Case examples",
  "Interactive discussion",
  "Audience questions and answers",
  "Implementation-focused next steps",
] as const;

/**
 * Platforms SLC tags (§21 "Social media handles"). Same list Sierra already
 * uses on the TSLS questionnaire, in her order — and, per her note on that
 * form, every one of them is optional: speakers often have nothing to put
 * for some.
 */
export const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Threads",
  "X (Twitter)",
  "LinkedIn",
  "TikTok",
  "YouTube",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Answers to "Will you be using a slideshow or visual presentation?" */
export const SLIDES_FORMATS = [
  "PowerPoint",
  "Keynote",
  "Google Slides",
  "PDF",
  "Other",
] as const;

export interface AdvisorIntake {
  phone: string;
  website: string;
  sessionTitle: string;
  sessionDescription: string;
  sessionTakeaways: string;
  preferredSessionDate: string;
  preferredSessionTime: string;
  sessionIncludes: string[];
  usesSlides: boolean | null;
  slidesFormat: string;
  needsAv: boolean | null;
  canJoinEarly: boolean | null;
  techNotes: string;
  materialsNotes: string;
  socialHandles: Record<string, string>;
  promoNotes: string;
  attendingSummit: boolean | null;
  panelAvailable: boolean | null;
  panelConflictNotes: string;
  podcastInterest: boolean | null;
  additionalNotes: string;
}

export const EMPTY_INTAKE: AdvisorIntake = {
  phone: "",
  website: "",
  sessionTitle: "",
  sessionDescription: "",
  sessionTakeaways: "",
  preferredSessionDate: "",
  preferredSessionTime: "",
  sessionIncludes: [],
  usesSlides: null,
  slidesFormat: "",
  needsAv: null,
  canJoinEarly: null,
  techNotes: "",
  materialsNotes: "",
  socialHandles: {},
  promoNotes: "",
  attendingSummit: null,
  panelAvailable: null,
  panelConflictNotes: "",
  podcastInterest: null,
  additionalNotes: "",
};

/*
 * What has to be answered before the intake counts as handed in.
 *
 * Kept deliberately short. §22 says materials are provided "by deadlines
 * reasonably established by SLC" — most of this form is SLC asking early,
 * not the Advisor being in breach for not knowing their slide format in
 * August. Only the things SLC cannot schedule or promote without are
 * required: what the session IS, and whether they can make the Summit panel.
 */
export const REQUIRED_FIELDS = [
  "sessionTitle",
  "sessionDescription",
  "panelAvailable",
] as const satisfies readonly (keyof AdvisorIntake)[];

export interface MissingField {
  field: keyof AdvisorIntake;
  label: string;
}

const REQUIRED_LABELS: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  sessionTitle: "Session title",
  sessionDescription: "Session description",
  panelAvailable: "Whether you can join the Summit panel",
};

/** Required answers still blank. Empty array means the intake can be handed in. */
export function missingRequired(intake: AdvisorIntake): MissingField[] {
  const missing: MissingField[] = [];
  for (const field of REQUIRED_FIELDS) {
    const value = intake[field];
    const blank =
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "");
    if (blank) missing.push({ field, label: REQUIRED_LABELS[field] });
  }
  return missing;
}

export function intakeIsComplete(intake: AdvisorIntake): boolean {
  return missingRequired(intake).length === 0;
}

/**
 * Who is asked to fill this in. TSLS Main Speakers are out for the same
 * reason as the agreement — §1 makes the Advisor role explicitly distinct
 * from a mainstage speaker role, and their intake is the Jotform, not this.
 *
 * The agreement WAIVER deliberately does not apply here. Waiving the
 * signature says "the contract is handled elsewhere"; it says nothing about
 * whether SLC needs a session title from them.
 */
export function intakeRequired(speaker: { tslsMainSpeaker: boolean }): boolean {
  return !speaker.tslsMainSpeaker;
}

/* -------------------------------------------------------------------------
 * Rendering + admin read-out
 *
 * One description of the form, used by both sides. `clause` is shown to
 * admins so it's obvious why a question exists; Advisors see `label` and
 * `help` only.
 * ---------------------------------------------------------------------- */

export type IntakeFieldKind =
  | "text"
  | "textarea"
  | "date"
  | "yesno"
  | "checklist"
  | "social";

export interface IntakeField {
  key: keyof AdvisorIntake;
  label: string;
  kind: IntakeFieldKind;
  /** Which clause of the agreement this question serves. */
  clause: string;
  help?: string;
  placeholder?: string;
  options?: readonly string[];
  /** Only shown when this other field is answered yes. */
  showWhen?: { field: keyof AdvisorIntake; equals: boolean };
}

export interface IntakeSection {
  title: string;
  /** One line under the heading — why this section is being asked. */
  intro: string;
  fields: IntakeField[];
}

export const INTAKE_SECTIONS: IntakeSection[] = [
  {
    title: "How we reach you",
    intro:
      "Contact details for the Momentum+ team. These are not shown to members.",
    fields: [
      {
        key: "phone",
        label: "Phone",
        kind: "text",
        clause: "§22 Contact information",
      },
      {
        key: "website",
        label: "Website",
        kind: "text",
        clause: "§21, §22 Website link",
        placeholder: "https://…",
      },
    ],
  },
  {
    title: "Your featured session",
    intro:
      "The live virtual session you lead during your featured month, about 60 minutes (§6).",
    fields: [
      {
        key: "sessionTitle",
        label: "Session title",
        kind: "text",
        clause: "§21, §22 Session title",
      },
      {
        key: "sessionDescription",
        label: "Session description",
        kind: "textarea",
        clause: "§21, §22 Session description",
        help: "What members will read when they decide whether to enroll.",
      },
      {
        key: "sessionTakeaways",
        label: "Participant takeaways",
        kind: "textarea",
        clause: "§22 Participant takeaways",
        help: "What someone should walk away able to do.",
      },
      {
        key: "sessionIncludes",
        label: "Your session will include",
        kind: "checklist",
        clause: "§6 The session may include",
        options: SESSION_INCLUDES_OPTIONS,
      },
      {
        key: "preferredSessionDate",
        label: "Preferred session date",
        kind: "date",
        clause: "§2 Anticipated Featured Session Date",
        help: "May move by mutual agreement, or by SLC for program scheduling (§2).",
      },
      {
        key: "preferredSessionTime",
        label: "Preferred session time",
        kind: "text",
        clause: "§2 Anticipated Featured Session Time",
        placeholder: "12:00 PM ET",
      },
    ],
  },
  {
    title: "Technology and preparation",
    intro:
      "So the session runs cleanly on the platform SLC provides (§23).",
    fields: [
      {
        key: "usesSlides",
        label: "Will you be using a slideshow or visual presentation?",
        kind: "yesno",
        clause: "§23 Provide presentation materials",
      },
      {
        key: "slidesFormat",
        label: "What format?",
        kind: "text",
        clause: "§23 Provide presentation materials",
        placeholder: SLIDES_FORMATS.join(" / "),
        showWhen: { field: "usesSlides", equals: true },
      },
      {
        key: "needsAv",
        label: "Will you need to play video or audio during the session?",
        kind: "yesno",
        clause: "§23 Technology and Session Preparation",
      },
      {
        key: "canJoinEarly",
        label: "Can you join early for a technology check if asked?",
        kind: "yesno",
        clause: "§23 Join the session early if requested for technology checks",
      },
      {
        key: "techNotes",
        label: "Anything about your setup we should know?",
        kind: "textarea",
        clause: "§23 Promptly communicate technical or scheduling concerns",
      },
    ],
  },
  {
    title: "Materials",
    intro:
      "Worksheets, tools, or handouts you plan to share with members (§22). Your headshot and organization logo are uploaded in Speaker Studio, and session files can be attached to the session itself.",
    fields: [
      {
        key: "materialsNotes",
        label: "Worksheets or supplemental resources you plan to share",
        kind: "textarea",
        clause: "§22 Worksheets, Supplemental resources",
      },
    ],
  },
  {
    title: "Promotion",
    intro:
      "SLC promotes your session through TSLS and Momentum+ channels (§10). All optional — leave blank anything you don't use.",
    fields: [
      {
        key: "socialHandles",
        label: "Social media handles",
        kind: "social",
        clause: "§21, §22 Social media handles",
        options: SOCIAL_PLATFORMS,
      },
      {
        key: "promoNotes",
        label: "Anything else you'd like included in promotion",
        kind: "textarea",
        clause: "§21 Approved promotional information",
      },
    ],
  },
  {
    title: "The Summit",
    intro:
      "The 2026 Tri-State Leadership Summit is Wednesday, October 14, 2026 at The Maryland Theatre in Hagerstown, Maryland (§3). Your complimentary VIP Leadership Experience ticket is included (§4).",
    fields: [
      {
        key: "attendingSummit",
        label: "Will you be attending the Summit?",
        kind: "yesno",
        clause: "§4 Complimentary Summit Admission",
      },
      {
        key: "panelAvailable",
        label:
          "Can you join the moderated Momentum+ Leadership Advisor panel at the Summit?",
        kind: "yesno",
        clause: "§3 Tri-State Leadership Summit Participation",
        help: "Not being able to make the panel does not affect your Momentum+ participation (§3).",
      },
      {
        key: "panelConflictNotes",
        label: "Scheduling conflicts we should know about",
        kind: "textarea",
        clause: "§3 Previously identified scheduling conflict",
        showWhen: { field: "panelAvailable", equals: false },
      },
    ],
  },
  {
    title: "Podcast",
    intro:
      "SLC may invite Advisors onto Branching Out with Sierra. Appearances aren't guaranteed unless separately confirmed in writing (§12).",
    fields: [
      {
        key: "podcastInterest",
        label: "Would you be interested in a podcast appearance?",
        kind: "yesno",
        clause: "§12 Podcast and Additional Promotional Opportunities",
      },
    ],
  },
  {
    title: "Anything else",
    intro: "Anything this form didn't ask about.",
    fields: [
      {
        key: "additionalNotes",
        label: "Additional requests or needs",
        kind: "textarea",
        clause: "—",
      },
    ],
  },
];

/** Every field, flattened — used by the admin read-out and by tests. */
export function allIntakeFields(): IntakeField[] {
  return INTAKE_SECTIONS.flatMap((s) => s.fields);
}

/** Is a conditional field currently in play? Unconditional fields always are. */
export function fieldIsVisible(
  field: IntakeField,
  intake: AdvisorIntake,
): boolean {
  if (!field.showWhen) return true;
  return intake[field.showWhen.field] === field.showWhen.equals;
}

/** An answer rendered for display, or null when it was left blank. */
export function displayAnswer(
  field: IntakeField,
  intake: AdvisorIntake,
): string | null {
  const value = intake[field.key];
  switch (field.kind) {
    case "yesno":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "checklist": {
      const list = value as string[];
      return list.length > 0 ? list.join(", ") : null;
    }
    case "social": {
      const handles = value as Record<string, string>;
      const filled = Object.entries(handles).filter(([, v]) => v.trim());
      return filled.length > 0
        ? filled.map(([k, v]) => `${k}: ${v}`).join("\n")
        : null;
    }
    default: {
      const text = String(value ?? "").trim();
      return text || null;
    }
  }
}
