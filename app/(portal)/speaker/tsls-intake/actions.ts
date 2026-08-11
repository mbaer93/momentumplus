"use server";

import { revalidatePath } from "next/cache";
import {
  TSLS_INTAKE_VERSION,
  allTslsFields,
  missingTslsAnswers,
  sanitizeTslsAnswers,
  tslsIntakeRequired,
  type TslsAnswers,
} from "@/lib/tsls-intake";
import { getTslsIntake } from "@/lib/tsls-intake-db";
import { getSpeakerForUser } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Saving the TSLS Speaker Tech Questionnaire.
 *
 * tsls_speaker_intake carries emergency contacts and health information and
 * has no write policy at all (migration 0085), so this is the only path in:
 * whose questionnaire is being written comes from the session cookie, and
 * every answer is validated against the question that offered it before it
 * reaches the row.
 */

export interface TslsIntakeResult {
  ok: boolean;
  message?: string;
  /** Labels of required questions still unanswered, when a submit failed. */
  missing?: string[];
}

const MAX_LONG = 4000;
const MAX_SHORT = 300;

export async function saveTslsIntake(
  payload: { answers: TslsAnswers; signedName: string; signedDate: string },
  intent: "draft" | "submit",
): Promise<TslsIntakeResult> {
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
  if (!tslsIntakeRequired(speaker)) {
    return {
      ok: false,
      message:
        "This questionnaire is for TSLS Main Speakers. Your intake is the Advisor session intake.",
    };
  }

  // Cap free text before anything else touches it.
  const longKeys = new Set(
    allTslsFields()
      .filter((f) => f.kind === "textarea")
      .map((f) => f.key),
  );
  const capped: TslsAnswers = {};
  for (const [key, value] of Object.entries(payload.answers ?? {})) {
    const limit = longKeys.has(key) ? MAX_LONG : MAX_SHORT;
    capped[key] = Array.isArray(value)
      ? value.map((v) => String(v).slice(0, MAX_SHORT))
      : String(value).slice(0, limit);
  }

  // Drop anything this form doesn't define, any option it doesn't offer, and
  // any answer to a question the speaker was not actually asked.
  const answers = sanitizeTslsAnswers(capped);
  const signedName = String(payload.signedName ?? "").trim().slice(0, MAX_SHORT);
  const signedDate = /^\d{4}-\d{2}-\d{2}$/.test(payload.signedDate ?? "")
    ? payload.signedDate
    : null;

  if (intent === "submit") {
    const missing = missingTslsAnswers({
      ...answers,
      // The signature block lives outside `answers` but is required to
      // submit, so fold it in for the completeness check.
      ...(signedName ? { signature: signedName } : {}),
      ...(signedDate ? { signatureDate: signedDate } : {}),
    });
    if (missing.length > 0) {
      return {
        ok: false,
        message: "A few required questions still need answering.",
        missing: missing.map((f) => f.label),
      };
    }
  }

  const existing = await getTslsIntake(speaker.id);
  const submittedAt =
    existing.submittedAt ?? (intent === "submit" ? new Date().toISOString() : null);

  const { error } = await createServiceClient()
    .from("tsls_speaker_intake")
    .upsert(
      {
        speaker_id: speaker.id,
        profile_id: user.id,
        form_version: TSLS_INTAKE_VERSION,
        answers,
        signed_name: signedName || null,
        signed_date: signedDate,
        submitted_at: submittedAt,
      },
      { onConflict: "speaker_id" },
    );
  if (error) {
    return {
      ok: false,
      message:
        "Couldn't save that. If this keeps happening, tell the TSLS team — the questionnaire table may not be set up yet.",
    };
  }

  revalidatePath("/speaker");
  revalidatePath("/speaker/tsls-intake");
  return {
    ok: true,
    message:
      intent === "submit"
        ? existing.submittedAt
          ? "Questionnaire updated."
          : "Questionnaire submitted — thank you. You can still come back and change anything."
        : "Draft saved.",
  };
}
