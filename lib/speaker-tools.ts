import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sponsorActive } from "@/lib/sponsor-lifecycle";
import type { SignedAgreement } from "@/lib/advisor-agreement";

/*
 * Speaker Studio support: resolve the speaker record owned by a signed-in
 * user, and the ownership guards behind every speaker self-service action.
 * A speaker whose season has ended (or who was archived) loses Studio
 * access along with member-facing visibility.
 */

export interface OwnSpeaker {
  id: string;
  name: string;
  title: string;
  bio: string;
  industries: string[];
  headshotUrl: string | null;
  resourceId: string | null;
  expiresAt: string | null;
  /** The speaker's own site (migration 0013). Seeds the Website answer on
      the TSLS questionnaire so nobody retypes what Momentum+ already has. */
  website: string | null;
  /** Speaker-of-the-month assignment ("YYYY-MM") — drives the Studio's
      members/earnings card. Null until an admin assigns a month. */
  speakerMonth: string | null;
  /** TSLS Main Speakers are unpaid — their card shows members, not money. */
  tslsMainSpeaker: boolean;
  /** Admin switch (migration 0082): false takes this speaker off the
      payment feature entirely. A missing column reads as true, so an
      un-migrated database keeps today's behaviour. */
  paymentAccess: boolean;
  /** Advisor's organization — §9 of the Leadership Advisor Agreement lists
      it among the community-visible profile fields (migration 0083). */
  organization: string | null;
  /** §2 "Anticipated Featured Session Date" — an intention, not a booking:
      the real event is a row in `sessions`. */
  featuredSessionDate: string | null;
  /** §2 "Anticipated Featured Session Time", free text ("12:00 PM ET"). */
  featuredSessionTime: string | null;
  /** Admin escape hatch (migration 0083): true lets this speaker into the
      Studio with no in-app signature. Missing column reads as false. */
  advisorAgreementWaived: boolean;
}

async function resolveSpeaker(
  column: "profile_id" | "id",
  value: string,
): Promise<OwnSpeaker | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const service = createServiceClient();
  let data: Record<string, unknown> | null = (
    await service
      .from("speakers")
      .select(
        "id, name, title, bio, industries, website, headshot_url, resource_id, expires_at, archived_at, speaker_month, tsls_main_speaker, payment_access, organization, featured_session_date, featured_session_time, advisor_agreement_waived",
      )
      .eq(column, value)
      .maybeSingle()
  ).data;
  if (!data) {
    // Pre-migration-0083 fallback (no advisor-agreement columns yet).
    data = (
      await service
        .from("speakers")
        .select(
          "id, name, title, bio, industries, website, headshot_url, resource_id, expires_at, archived_at, speaker_month, tsls_main_speaker, payment_access",
        )
        .eq(column, value)
        .maybeSingle()
    ).data;
  }
  if (!data) {
    // Pre-migration-0082 fallback (no payment_access column yet).
    data = (
      await service
        .from("speakers")
        .select(
          "id, name, title, bio, industries, website, headshot_url, resource_id, expires_at, archived_at, speaker_month, tsls_main_speaker",
        )
        .eq(column, value)
        .maybeSingle()
    ).data;
  }
  if (!data) {
    // Pre-migration-0053 fallback (no speaker-month columns yet).
    data = (
      await service
        .from("speakers")
        .select(
          "id, name, title, bio, industries, website, headshot_url, resource_id, expires_at, archived_at",
        )
        .eq(column, value)
        .maybeSingle()
    ).data;
  }
  if (!data) return null;
  if (
    !sponsorActive({
      archivedAt: (data.archived_at as string | null) ?? null,
      expiresAt: (data.expires_at as string | null) ?? null,
    })
  ) {
    return null;
  }
  return {
    id: data.id as string,
    name: (data.name as string) ?? "",
    title: (data.title as string) ?? "",
    bio: (data.bio as string) ?? "",
    industries: (data.industries as string[]) ?? [],
    headshotUrl: (data.headshot_url as string | null) ?? null,
    resourceId: (data.resource_id as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
    website: (data.website as string | null) ?? null,
    speakerMonth: (data.speaker_month as string | null) ?? null,
    tslsMainSpeaker: Boolean(data.tsls_main_speaker),
    // Absent/null (pre-0082, or a row written before the default landed)
    // means "has payment access" — only an explicit false takes it away.
    paymentAccess: data.payment_access !== false,
    organization: (data.organization as string | null) ?? null,
    featuredSessionDate: (data.featured_session_date as string | null) ?? null,
    featuredSessionTime: (data.featured_session_time as string | null) ?? null,
    // Pre-0083 reads as false: nobody is waived until an admin says so.
    advisorAgreementWaived: data.advisor_agreement_waived === true,
  };
}

/**
 * The speaker's most recent Leadership Advisor signature, or null if they
 * have never signed. Newest first — §32 lets the agreement be amended, so a
 * speaker can hold several rows and only the latest one decides the gate.
 *
 * Returns null (rather than throwing) when migration 0083 hasn't run, so the
 * Studio keeps working on a database that predates the table.
 */
export async function latestAdvisorAgreement(
  speakerId: string,
): Promise<SignedAgreement | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const { data, error } = await createServiceClient()
    .from("advisor_agreements")
    .select("agreement_version, signed_name, signed_at")
    .eq("speaker_id", speakerId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    agreementVersion: data.agreement_version as string,
    signedName: data.signed_name as string,
    signedAt: data.signed_at as string,
  };
}

export async function getSpeakerForUser(
  userId: string,
): Promise<OwnSpeaker | null> {
  return resolveSpeaker("profile_id", userId);
}

/**
 * A speaker by their row id — how an admin opens someone's Studio to see
 * what that speaker sees. Same active-season rule as the owner path: an
 * archived or expired speaker has no Studio for anyone.
 */
export async function getSpeakerById(
  speakerId: string,
): Promise<OwnSpeaker | null> {
  return resolveSpeaker("id", speakerId);
}

/** True when `userId` is the active speaker who owns `sessionId`. */
export async function speakerOwnsSession(
  userId: string,
  sessionId: string,
): Promise<{ ok: boolean; speakerId?: string }> {
  const speaker = await getSpeakerForUser(userId);
  if (!speaker) return { ok: false };
  const { data } = await createServiceClient()
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("speaker_id", speaker.id)
    .maybeSingle();
  return data ? { ok: true, speakerId: speaker.id } : { ok: false };
}
