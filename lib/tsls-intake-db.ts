import type { TslsAnswers } from "@/lib/tsls-intake";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Storage side of the TSLS Speaker Tech Questionnaire (migration 0085).
 * Split from lib/tsls-intake.ts so the question definitions stay importable
 * from a client component — this half pulls in the service client.
 */

export interface StoredTslsIntake {
  answers: TslsAnswers;
  signedName: string;
  signedDate: string;
  formVersion: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  exists: boolean;
}

export const NO_TSLS_INTAKE: StoredTslsIntake = {
  answers: {},
  signedName: "",
  signedDate: "",
  formVersion: null,
  submittedAt: null,
  updatedAt: null,
  exists: false,
};

/** jsonb comes back as unknown; keep only string / string[] entries. */
export function coerceAnswers(raw: unknown): TslsAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const answers: TslsAnswers = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      answers[key] = value;
    } else if (Array.isArray(value)) {
      answers[key] = value.filter((v): v is string => typeof v === "string");
    }
  }
  return answers;
}

export async function getTslsIntake(
  speakerId: string,
): Promise<StoredTslsIntake> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NO_TSLS_INTAKE;
  }
  const { data, error } = await createServiceClient()
    .from("tsls_speaker_intake")
    .select(
      "answers, signed_name, signed_date, form_version, submitted_at, updated_at",
    )
    .eq("speaker_id", speakerId)
    .maybeSingle();
  // An error here means migration 0085 hasn't run — offer a blank form
  // rather than erroring on a database that predates the table.
  if (error || !data) return NO_TSLS_INTAKE;
  return {
    answers: coerceAnswers(data.answers),
    signedName: (data.signed_name as string | null) ?? "",
    signedDate: (data.signed_date as string | null) ?? "",
    formVersion: (data.form_version as string | null) ?? null,
    submittedAt: (data.submitted_at as string | null) ?? null,
    updatedAt: (data.updated_at as string | null) ?? null,
    exists: true,
  };
}

/** submitted_at/updated_at per speaker — the admin list's status column. */
export async function tslsIntakeStatusBySpeaker(): Promise<
  Map<string, { submittedAt: string | null; updatedAt: string | null }>
> {
  const status = new Map<
    string,
    { submittedAt: string | null; updatedAt: string | null }
  >();
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return status;
  }
  const { data, error } = await createServiceClient()
    .from("tsls_speaker_intake")
    .select("speaker_id, submitted_at, updated_at");
  if (error || !data) return status;
  for (const row of data) {
    status.set(row.speaker_id as string, {
      submittedAt: (row.submitted_at as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
    });
  }
  return status;
}
