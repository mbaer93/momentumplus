/*
 * TSLS Speaker Tech Questionnaire — the intake for mainstage Summit speakers.
 *
 * Every question, option, required flag, and notice below is transcribed
 * VERBATIM from Sierra's live Jotform (form 250896885391071, last edited
 * 2026-07-24), in the order the form asks them. This is her wording and her
 * event policy: do not reword, re-order, or "tidy" any of it. Changing an
 * option here changes what a speaker is answering.
 *
 * ONE DELIBERATE EXCEPTION, and it is marked at the field: Website is
 * optional here and required on the Jotform. Nothing else diverges — if you
 * find a second difference, it is a transcription bug, not a decision.
 *
 * This is the counterpart to lib/advisor-intake.ts, and the two never
 * overlap: a TSLS Main Speaker answers THIS (stage, mics, dressing rooms,
 * call times at The Maryland Theatre), a Leadership Advisor answers that one
 * (their virtual featured session under §6 of the Advisor Agreement).
 *
 * Answers are stored as a key -> value map rather than one column per
 * question. With ~50 questions mirrored from a form Sierra edits herself,
 * typed columns would mean a migration every time she adds a checkbox; the
 * question set lives here in code and the shape follows it.
 */

/** Bumped whenever the question set below changes, so a stored answer map
    can always be read back against the questions that produced it. Was
    "2026-07-24", matching the Jotform's own last-edited date; it moves off
    that date here because the Website field is deliberately optional in this
    copy (see the field), so the two question sets are no longer identical. */
export const TSLS_INTAKE_VERSION = "2026-08-11";

export const TSLS_INTAKE_TITLE = "Speaker Tech Questionnaire";

export const TSLS_INTAKE_INTRO =
  "We apologize for length of this form, however we want to make the event as seamless and comfortable as possible. If you have any issues in completing this form, or any questions, please email matt@sierralearnership.com";

export type TslsFieldKind =
  | "text"
  | "tel"
  | "email"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "acknowledgement"
  | "signature"
  | "date";

/** Show this field only when another field's answer matches. */
export interface TslsCondition {
  field: string;
  /** Any one of these values reveals the field. */
  anyOf: string[];
}

export interface TslsField {
  key: string;
  label: string;
  kind: TslsFieldKind;
  required: boolean;
  options?: readonly string[];
  showWhen?: TslsCondition;
}

/** A block of Sierra's event copy shown between questions. */
export interface TslsNotice {
  text: string;
}

export interface TslsSection {
  title: string;
  /** Notices shown above the section's questions, in order. */
  notices?: TslsNotice[];
  fields: TslsField[];
}

const YES_NO = ["Yes", "No"] as const;

/** Slideshow answers that mean "yes, I'm presenting something". */
export const SLIDESHOW_YES = [
  "Yes, PowerPoint",
  "Yes, Keynote",
  "Yes, PDF",
  "Yes, Google Slides",
  "other",
] as const;

/** Drink answers that trigger "How do you take your beverage?". */
export const BEVERAGE_FOLLOWUP = ["Coffee", "Tea", "other"] as const;

export const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Threads",
  "X (Twitter)",
  "LinkedIn",
  "TikTok",
  "YouTube",
] as const;

/** handle field key for a platform, e.g. "handle:LinkedIn". */
export function handleKey(platform: string): string {
  return `handle:${platform}`;
}

export const TSLS_INTAKE_SECTIONS: TslsSection[] = [
  {
    title: "Basic Information",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "phone", label: "Phone Number", kind: "tel", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      {
        key: "tshirtSize",
        label: "Unisex T-Shirt Size",
        kind: "select",
        required: true,
        options: [
          "Extra Small",
          "Small",
          "Medium",
          "Large",
          "Extra large",
          "XXL",
          "XXXL",
        ],
      },
      /*
       * OPTIONAL here, required on the Jotform — the one place this file
       * knowingly diverges from Sierra's form (Matt, 2026-08-11).
       *
       * Website was added to the Jotform partway through July: of the five
       * submissions it holds, the three from 2026-07-07 and 2026-07-09
       * (Sierra, the "John Smith" test row, Holly) have no answer for it,
       * while 2026-07-27 and 2026-07-30 (Rob, Allison) do. Those blanks are
       * evidence the field did not exist yet, NOT evidence those people have
       * no website — but they do show the form was submittable without it.
       *
       * Required would block a speaker with no site from filing a ~70-answer
       * questionnaire over a promo field, unlike the emergency contact or
       * stage questions that actually gate event logistics. The page seeds
       * this from speakers.website, so anyone whose site Momentum+ already
       * knows still arrives with it filled in.
       */
      { key: "website", label: "Website", kind: "text", required: false },
    ],
  },
  {
    title: "Emergency Information",
    fields: [
      {
        key: "emergencyContactName",
        label: "Emergency Contact Name",
        kind: "text",
        required: true,
      },
      {
        key: "emergencyContactPhone",
        label: "Emergency Contact Phone Number",
        kind: "tel",
        required: true,
      },
      {
        key: "healthConcerns",
        label: "Are there any health concerns we should be aware of?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "healthConcernsDetail",
        label: "Please list anything you feel we should be aware of",
        kind: "textarea",
        required: true,
        showWhen: { field: "healthConcerns", anyOf: ["Yes"] },
      },
    ],
  },
  {
    title: "Hospitality",
    fields: [
      {
        key: "drinkPreference",
        label: "Drink Preference on Stage",
        kind: "radio",
        required: true,
        options: ["Water", "Coffee", "Tea", "other"],
      },
      {
        key: "beveragePreparation",
        label: "How do you take your beverage?",
        kind: "text",
        required: true,
        showWhen: { field: "drinkPreference", anyOf: [...BEVERAGE_FOLLOWUP] },
      },
      {
        key: "dietaryRestrictions",
        label: "Do you have any dietary restrictions/allergies?",
        kind: "text",
        required: true,
      },
      {
        key: "greenRoomRequests",
        label:
          "Do you have any green room requests? (We will do our best to accommodate)",
        kind: "textarea",
        required: false,
      },
    ],
  },
  {
    title: "Back Stage Access",
    notices: [
      {
        text: "Space is limited. As a result, you may have to share the dressing room with another speaker. We also will only be able to accommodate two guests per speaker at one time. Security staff at the stage will control backstage access. The theatre is historic, there are a few areas that can be hazardous, so all guests must be escorted to the dressing rooms. Anyone who is not listed as a guest will not be permitted to enter without explicit consent of the speakers or production manager. All guests must be registered to attend the event. If your guest is attending only as an assistant or service provider for you, please contact Matt Baer at matt@sierralearnership.com",
      },
    ],
    fields: [
      {
        key: "backstageGuests",
        label:
          "Do you intend to have any guests backstage with you during the event?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "backstageGuestList",
        label: "Please list any guests that you plan to have join you backstage.",
        kind: "textarea",
        required: true,
        showWhen: { field: "backstageGuests", anyOf: ["Yes"] },
      },
      {
        key: "hairAndMakeup",
        label:
          "TSLS intends to have a professional available for hair and makeup. Will you be interested in either service?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
    ],
  },
  {
    title: "Audio/Video/Presentation:",
    notices: [
      {
        text: "Please review the dressing room map for your room assignments and to see the accommodations available. The dressing rooms are located below the stage, there will be refreshments in the common area.",
      },
    ],
    fields: [
      {
        key: "microphonePreference",
        label: "Do you have a microphone preference?",
        kind: "radio",
        required: true,
        options: ["No Preference", "Lapel/Lavalier mic", "Handheld"],
      },
      {
        key: "stageMovement",
        label: "Will you be moving around the stage or staying in one spot?",
        kind: "radio",
        required: true,
        options: ["Moving", "Standing", "Sitting"],
      },
      {
        key: "audioPlayback",
        label:
          "Will you need audio playback for video or music in your presentation?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "stageIntroduction",
        label:
          "How would you like to be introduced on stage? This is distinct from your full bio. Please provide a 3–5-sentence intro script — or at minimum the key points you want highlighted.",
        kind: "textarea",
        required: true,
      },
      {
        key: "slideshow",
        label: "Will you be using a slideshow or visual presentation?",
        kind: "radio",
        required: true,
        options: [
          "Yes, PowerPoint",
          "Yes, Keynote",
          "Yes, PDF",
          "Yes, Google Slides",
          "No",
          "other",
        ],
      },
      {
        key: "playsClip",
        label:
          "Will you need to play a video or audio clip during your presentation?",
        kind: "radio",
        required: true,
        options: YES_NO,
        showWhen: { field: "slideshow", anyOf: [...SLIDESHOW_YES] },
      },
      {
        key: "needsInternet",
        label: "Do you need internet access during your presentation?",
        kind: "radio",
        required: true,
        options: YES_NO,
        showWhen: { field: "slideshow", anyOf: [...SLIDESHOW_YES] },
      },
      {
        key: "audienceHandouts",
        label:
          "Will you be handing out anything to the audience during your presentation?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "handoutsAcknowledgement",
        label:
          "You will be responsible for purchasing and supplying all materials you hand out during your presentation. These must be submitted to the Production Manager on the 13th. These are not to be promotional items; they must have a tie to your presentation.",
        kind: "acknowledgement",
        required: true,
        options: ["I understand"],
      },
      {
        key: "contentStandardsAcknowledgement",
        label:
          "As a reminder, all presentations are subject to the content standards outlined in the RFP and your speaker agreement.",
        kind: "acknowledgement",
        required: true,
        options: ["I understand"],
      },
      {
        key: "presentationDeadlineAcknowledgement",
        label:
          "All Presentations must be submitted digitally to matt@sierralearnership.com via email or Google Drive link by September 28th as this is required by the theatre. You can also submit via thumb drive. This must be the final draft of your presentation as this will be given to the Theatre and there will not be an opportunity to update from this time.",
        kind: "acknowledgement",
        required: true,
        options: ["I understand and agree to submit by the date stated."],
        showWhen: { field: "slideshow", anyOf: [...SLIDESHOW_YES] },
      },
    ],
  },
  {
    title: "Logistics:",
    notices: [
      {
        text: "There will be a confidence monitor on stage for you to see any notes for your presentation. There will also be a show clock showing you how much time is remaining in your session. Please respect this time as it will be a very tight schedule.",
      },
    ],
    fields: [
      {
        key: "stageProps",
        label:
          "Do you have accent items/props you plan to bring on stage with you?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "stagePropsDetail",
        label: "Please Describe the items.",
        kind: "text",
        required: true,
        showWhen: { field: "stageProps", anyOf: ["Yes"] },
      },
      {
        key: "podiumOrTable",
        label: "Do you need a podium or table on stage?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "stoolOrChair",
        label: "Would you like a stool or chair on stage?",
        kind: "radio",
        required: true,
        options: ["Stool", "Chair", "No"],
      },
      {
        key: "accessibilityNeeds",
        label: "Do you have any accessibility needs or preferences?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "vipLunchAcknowledgement",
        label:
          "Lunch will be provided at the event. Speaker's lunch will be in the ballroom with VIP attendees. Speakers are expected to make themselves available to mingle and answer questions with VIPs during this time.",
        kind: "acknowledgement",
        required: true,
        options: ["I understand and agree to this expectation"],
      },
    ],
  },
  {
    title: "Social Media",
    fields: [
      {
        key: "socialPlatforms",
        label: "Please Select All Social Media Platforms You Use",
        kind: "checkbox",
        required: true,
        options: SOCIAL_PLATFORMS,
      },
      ...SOCIAL_PLATFORMS.map(
        (platform): TslsField => ({
          key: handleKey(platform),
          label: `Please provide your ${platform} handle so we can tag you`,
          kind: "text",
          required: true,
          showWhen: { field: "socialPlatforms", anyOf: [platform] },
        }),
      ),
    ],
  },
  {
    title: "Pre Event",
    notices: [
      {
        text: "There will be a tech-check on the 13th to go over the stage, lighting and equipment.",
      },
      {
        text: "We will be setting up for the event on the 13th, our goal is to have all speakers at the theatre at 11:00 am to meet with our Speaker Coordinator. We will then have a brief meeting with Speakers and Stage crew at 11:30 am, this is to go over safety, theatre rules and an overview of the equipment and procedures for the event. We will then break for lunch at noon. At 1:00pm we must be on stage at the theatre to begin sound checks and to set the stage with the theatre's staff. This should take approximately 15-20 minutes per speaker. The plan will be to have speakers go in order of when they appear on stage at the event. We will also be going to dinner on the 13th as a group at 5:00 pm. Unfortunately at this time TSLS will not be providing lunch or dinner on the 13th.",
      },
    ],
    fields: [
      {
        key: "availableOct13",
        label:
          "Will you be able to be at The Maryland Theatre on October 13th from 11:00 to approximately 3:00pm?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "lunch13th",
        label:
          "Will you be joining the group for lunch on the 13th at a local restaurant?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "dinner13th",
        label:
          "Will you be joining the group for dinner on the 13th at a local restaurant?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
    ],
  },
  {
    title: "Post Event",
    notices: [
      {
        text: "At the conclusion of the event at 4:00 pm, guests will exiting the theatre and attending the networking happy hour. Speakers are encouraged to attend. We must be out of the theatre no later than 7:00 pm. Any belongings left behind will be collected and you can reach out to Matt to retrieve. TSLS staff and speakers are invited to join us for refreshments at a local restaurant, where we will discuss what went well and where we can improve for 2027. This is not required, however as a speaker your input is highly valued.",
      },
    ],
    fields: [
      {
        key: "refreshments14th",
        label:
          "Will you be joining the group for refreshments on the 14th at a local restaurant?",
        kind: "radio",
        required: true,
        options: YES_NO,
      },
      {
        key: "additionalRequests",
        label:
          "Do you have any additional requests or needs not covered in this form?",
        kind: "textarea",
        required: false,
      },
      {
        key: "signature",
        label: "Signature",
        kind: "signature",
        required: true,
      },
      {
        key: "signatureDate",
        label: "Today's Date",
        kind: "date",
        required: true,
      },
    ],
  },
];

/* -------------------------------------------------------------------------
 * Answers
 * ---------------------------------------------------------------------- */

/** A single-value answer, or the selected set for a checkbox question. */
export type TslsAnswer = string | string[];
export type TslsAnswers = Record<string, TslsAnswer>;

export function allTslsFields(): TslsField[] {
  return TSLS_INTAKE_SECTIONS.flatMap((s) => s.fields);
}

export function tslsFieldByKey(key: string): TslsField | undefined {
  return allTslsFields().find((f) => f.key === key);
}

function answerValues(answers: TslsAnswers, key: string): string[] {
  const value = answers[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

/**
 * Is this field currently being asked? A conditional field is only in play
 * when its trigger holds — and an answer to a field that is NOT in play is
 * never required and never counted.
 */
export function tslsFieldVisible(field: TslsField, answers: TslsAnswers): boolean {
  if (!field.showWhen) return true;
  const current = answerValues(answers, field.showWhen.field);
  return field.showWhen.anyOf.some((v) => current.includes(v));
}

export function answerIsBlank(answer: TslsAnswer | undefined): boolean {
  if (answer === undefined) return true;
  if (Array.isArray(answer)) return answer.length === 0;
  return answer.trim() === "";
}

/**
 * Required questions the speaker still has to answer. Only visible fields
 * count: a hidden follow-up cannot block a submission, which is exactly how
 * the Jotform behaves.
 */
export function missingTslsAnswers(answers: TslsAnswers): TslsField[] {
  return allTslsFields().filter(
    (f) =>
      f.required &&
      tslsFieldVisible(f, answers) &&
      answerIsBlank(answers[f.key]),
  );
}

export function tslsIntakeComplete(answers: TslsAnswers): boolean {
  return missingTslsAnswers(answers).length === 0;
}

/**
 * Drop answers to questions that are no longer being asked. Someone can
 * answer "Yes, PowerPoint", fill in the follow-ups, then switch to "No" —
 * without this, the stale follow-ups stay in the record and an admin reads
 * answers to questions the speaker didn't end up being asked.
 *
 * Runs to a fixed point because conditions can chain.
 */
export function pruneHiddenAnswers(answers: TslsAnswers): TslsAnswers {
  let current: TslsAnswers = { ...answers };
  for (let pass = 0; pass < 5; pass++) {
    const next: TslsAnswers = {};
    for (const field of allTslsFields()) {
      if (!tslsFieldVisible(field, current)) continue;
      if (field.key in current) next[field.key] = current[field.key];
    }
    const settled =
      Object.keys(next).length === Object.keys(current).length;
    current = next;
    if (settled) break;
  }
  return current;
}

/**
 * Keep only answers this form actually defines, and only values the question
 * offers. A hand-rolled POST cannot write an arbitrary option into the
 * record — the Jotform validates its own options, and so does this.
 */
export function sanitizeTslsAnswers(raw: TslsAnswers): TslsAnswers {
  const clean: TslsAnswers = {};
  for (const field of allTslsFields()) {
    const value = raw[field.key];
    if (value === undefined) continue;

    if (field.kind === "checkbox") {
      const allowed = field.options ?? [];
      const list = (Array.isArray(value) ? value : [value]).filter((v) =>
        (allowed as readonly string[]).includes(v),
      );
      if (list.length > 0) clean[field.key] = list;
      continue;
    }

    const text = Array.isArray(value) ? (value[0] ?? "") : value;
    if (typeof text !== "string" || !text.trim()) continue;

    if (field.options && field.kind !== "text") {
      if (!(field.options as readonly string[]).includes(text)) continue;
    }
    clean[field.key] = text.trim();
  }
  return pruneHiddenAnswers(clean);
}

/** An answer rendered for the admin read-out, or null when unanswered. */
export function displayTslsAnswer(
  field: TslsField,
  answers: TslsAnswers,
): string | null {
  const value = answers[field.key];
  if (answerIsBlank(value)) return null;
  return Array.isArray(value) ? value.join(", ") : value.trim();
}

/**
 * Who answers this form. TSLS Main Speakers — the mainstage lineup, which
 * the TSLS pull flags itself from the event's roster. Leadership Advisors
 * answer the Advisor session intake instead; the two sets never overlap.
 */
export function tslsIntakeRequired(speaker: { tslsMainSpeaker: boolean }): boolean {
  return speaker.tslsMainSpeaker;
}
