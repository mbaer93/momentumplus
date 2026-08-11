import { EMPTY_INTAKE, type AdvisorIntake } from "@/lib/advisor-intake";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Storage side of the Advisor session intake (migration 0084).
 *
 * Split from lib/advisor-intake.ts so the question definitions stay
 * importable from a client component — this half pulls in the service
 * client and must never cross into the browser bundle.
 */

const COLUMNS =
  "speaker_id, phone, website, session_title, session_description, session_takeaways, " +
  "preferred_session_date, preferred_session_time, session_includes, uses_slides, " +
  "slides_format, needs_av, can_join_early, tech_notes, materials_notes, social_handles, " +
  "promo_notes, attending_summit, panel_available, panel_conflict_notes, podcast_interest, " +
  "additional_notes, submitted_at, updated_at";

export interface StoredIntake {
  intake: AdvisorIntake;
  /** Null until the Advisor has handed it in at least once. */
  submittedAt: string | null;
  updatedAt: string | null;
  /** False when there's no row yet — nothing has ever been saved. */
  exists: boolean;
}

export const NO_INTAKE: StoredIntake = {
  intake: EMPTY_INTAKE,
  submittedAt: null,
  updatedAt: null,
  exists: false,
};

/** "" for a null column, so the form's inputs stay controlled. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Tri-state: a yes/no question genuinely has an unanswered state. */
function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function rowToIntake(row: Record<string, unknown>): AdvisorIntake {
  const handles = row.social_handles;
  return {
    phone: text(row.phone),
    website: text(row.website),
    sessionTitle: text(row.session_title),
    sessionDescription: text(row.session_description),
    sessionTakeaways: text(row.session_takeaways),
    preferredSessionDate: text(row.preferred_session_date),
    preferredSessionTime: text(row.preferred_session_time),
    sessionIncludes: Array.isArray(row.session_includes)
      ? (row.session_includes as string[])
      : [],
    usesSlides: bool(row.uses_slides),
    slidesFormat: text(row.slides_format),
    needsAv: bool(row.needs_av),
    canJoinEarly: bool(row.can_join_early),
    techNotes: text(row.tech_notes),
    materialsNotes: text(row.materials_notes),
    socialHandles:
      handles && typeof handles === "object" && !Array.isArray(handles)
        ? (handles as Record<string, string>)
        : {},
    promoNotes: text(row.promo_notes),
    attendingSummit: bool(row.attending_summit),
    panelAvailable: bool(row.panel_available),
    panelConflictNotes: text(row.panel_conflict_notes),
    podcastInterest: bool(row.podcast_interest),
    additionalNotes: text(row.additional_notes),
  };
}

/** "" -> null, so a cleared field stores as NULL rather than an empty string. */
function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function intakeToRow(
  speakerId: string,
  profileId: string | null,
  intake: AdvisorIntake,
): Record<string, unknown> {
  return {
    speaker_id: speakerId,
    profile_id: profileId,
    phone: nullable(intake.phone),
    website: nullable(intake.website),
    session_title: nullable(intake.sessionTitle),
    session_description: nullable(intake.sessionDescription),
    session_takeaways: nullable(intake.sessionTakeaways),
    // A date column rejects ""; only a real YYYY-MM-DD is stored.
    preferred_session_date: /^\d{4}-\d{2}-\d{2}$/.test(
      intake.preferredSessionDate.trim(),
    )
      ? intake.preferredSessionDate.trim()
      : null,
    preferred_session_time: nullable(intake.preferredSessionTime),
    session_includes: intake.sessionIncludes,
    uses_slides: intake.usesSlides,
    slides_format: nullable(intake.slidesFormat),
    needs_av: intake.needsAv,
    can_join_early: intake.canJoinEarly,
    tech_notes: nullable(intake.techNotes),
    materials_notes: nullable(intake.materialsNotes),
    // Blank handles are dropped rather than stored as "" — §21 asks for the
    // ones they have, and an empty string is not a handle.
    social_handles: Object.fromEntries(
      Object.entries(intake.socialHandles)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    ),
    promo_notes: nullable(intake.promoNotes),
    attending_summit: intake.attendingSummit,
    panel_available: intake.panelAvailable,
    panel_conflict_notes: nullable(intake.panelConflictNotes),
    podcast_interest: intake.podcastInterest,
    additional_notes: nullable(intake.additionalNotes),
  };
}

/**
 * One Advisor's intake. Returns NO_INTAKE when nothing is saved yet, and
 * also when migration 0084 hasn't run — the page then offers a blank form
 * rather than erroring on a database that predates the table.
 */
export async function getAdvisorIntake(
  speakerId: string,
): Promise<StoredIntake> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NO_INTAKE;
  }
  const { data, error } = await createServiceClient()
    .from("advisor_intake")
    .select(COLUMNS)
    .eq("speaker_id", speakerId)
    .maybeSingle();
  if (error || !data) return NO_INTAKE;
  // The column list is assembled as a string, so supabase-js can't infer a
  // row shape for it; rowToIntake does the per-field narrowing.
  const row = data as unknown as Record<string, unknown>;
  return {
    intake: rowToIntake(row),
    submittedAt: (row.submitted_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    exists: true,
  };
}

/**
 * submitted_at for every Advisor who has one, keyed by speaker id — the
 * admin list's "handed in / not started" column in a single query. An
 * error (pre-0084) reads as an empty map, i.e. nobody has filled it in.
 */
export async function intakeStatusBySpeaker(): Promise<
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
    .from("advisor_intake")
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
