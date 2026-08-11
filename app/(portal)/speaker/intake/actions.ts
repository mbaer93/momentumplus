"use server";

import { revalidatePath } from "next/cache";
import {
  SOCIAL_PLATFORMS,
  SESSION_INCLUDES_OPTIONS,
  intakeRequired,
  missingRequired,
  type AdvisorIntake,
} from "@/lib/advisor-intake";
import { getAdvisorIntake, intakeToRow } from "@/lib/advisor-intake-db";
import { getSpeakerForUser } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Saving the Advisor session intake.
 *
 * Same shape as the agreement's signing action: advisor_intake has no write
 * policy at all, so this is the only path in, and WHOSE intake is being
 * written is resolved from the session cookie rather than the form body.
 *
 * Two ways to save. "Save draft" stores whatever is filled in and leaves
 * submitted_at alone; "Submit" additionally requires the handful of answers
 * SLC cannot schedule or promote without. Editing after submitting keeps
 * submitted_at — handing it in is a fact about the past.
 */

export interface IntakeResult {
  ok: boolean;
  message?: string;
  /** Required answers still blank, when a submit was rejected for it. */
  missing?: string[];
}

/** Long-form answers are capped so a paste-bomb can't land in the table. */
const MAX_LONG = 4000;
const MAX_SHORT = 300;

function short(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim().slice(0, MAX_SHORT);
}

function long(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim().slice(0, MAX_LONG);
}

/** Radio group with a genuine third state: "" means still unanswered. */
function triState(formData: FormData, key: string): boolean | null {
  const raw = formData.get(key);
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/* Not exported: a "use server" module may only export async functions, and
   this is a pure mapper. Its behaviour is covered through intakeToRow /
   rowToIntake in tests/advisor-intake.test.ts. */
function intakeFromForm(formData: FormData): AdvisorIntake {
  const socialHandles: Record<string, string> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const handle = short(formData, `social:${platform}`);
    if (handle) socialHandles[platform] = handle;
  }
  return {
    phone: short(formData, "phone"),
    website: short(formData, "website"),
    sessionTitle: short(formData, "sessionTitle"),
    sessionDescription: long(formData, "sessionDescription"),
    sessionTakeaways: long(formData, "sessionTakeaways"),
    preferredSessionDate: short(formData, "preferredSessionDate"),
    preferredSessionTime: short(formData, "preferredSessionTime"),
    // Only the eight options from §6 are accepted — a hand-crafted POST
    // can't write arbitrary strings into the column.
    sessionIncludes: formData
      .getAll("sessionIncludes")
      .map(String)
      .filter((v): v is (typeof SESSION_INCLUDES_OPTIONS)[number] =>
        (SESSION_INCLUDES_OPTIONS as readonly string[]).includes(v),
      ),
    usesSlides: triState(formData, "usesSlides"),
    slidesFormat: short(formData, "slidesFormat"),
    needsAv: triState(formData, "needsAv"),
    canJoinEarly: triState(formData, "canJoinEarly"),
    techNotes: long(formData, "techNotes"),
    materialsNotes: long(formData, "materialsNotes"),
    socialHandles,
    promoNotes: long(formData, "promoNotes"),
    attendingSummit: triState(formData, "attendingSummit"),
    panelAvailable: triState(formData, "panelAvailable"),
    panelConflictNotes: long(formData, "panelConflictNotes"),
    podcastInterest: triState(formData, "podcastInterest"),
    additionalNotes: long(formData, "additionalNotes"),
  };
}

export async function saveAdvisorIntake(
  formData: FormData,
): Promise<IntakeResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const speaker = await getSpeakerForUser(user.id);
  if (!speaker) {
    return { ok: false, message: "No active speaker profile on this account." };
  }
  if (!intakeRequired(speaker)) {
    return {
      ok: false,
      message: "This intake isn't required for your speaker profile.",
    };
  }

  const intake = intakeFromForm(formData);
  const submitting = formData.get("intent") === "submit";

  if (submitting) {
    const missing = missingRequired(intake);
    if (missing.length > 0) {
      return {
        ok: false,
        message:
          "Almost — a few answers are still needed before this can be handed in.",
        missing: missing.map((m) => m.label),
      };
    }
  }

  // Preserve an existing submitted_at: editing after handing in doesn't
  // un-hand-it-in, and re-submitting doesn't reset the date it arrived.
  const existing = await getAdvisorIntake(speaker.id);
  const submittedAt =
    existing.submittedAt ?? (submitting ? new Date().toISOString() : null);

  const { error } = await createServiceClient()
    .from("advisor_intake")
    .upsert(
      {
        ...intakeToRow(speaker.id, user.id, intake),
        submitted_at: submittedAt,
      },
      { onConflict: "speaker_id" },
    );
  if (error) {
    return {
      ok: false,
      message:
        "Couldn't save that. If this keeps happening, tell the Momentum+ team — the intake table may not be set up yet.",
    };
  }

  revalidatePath("/speaker");
  revalidatePath("/speaker/intake");
  return {
    ok: true,
    message: submitting
      ? existing.submittedAt
        ? "Intake updated."
        : "Intake submitted — thank you. You can still come back and change anything."
      : "Draft saved.",
  };
}
