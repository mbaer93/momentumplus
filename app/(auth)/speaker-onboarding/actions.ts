"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { seasonEnd } from "@/lib/sponsor-lifecycle";
import {
  missingFieldsSentence,
  missingSpeakerFields,
} from "@/lib/speaker-profile";

/*
 * Completion of a speaker invite: the signed-in speaker submits their
 * speaker-page details, their business (published as their single resource
 * page), and their personal info. Creates the speaker record (season ends
 * October 1 of next year), the business resource, and speaker-tier access
 * to the same date. The invite row (service-role only) is the
 * authorization.
 */

export interface SpeakerOnboardingInput {
  displayName: string;
  speakerTitle: string;
  bio: string;
  industries: string;
  businessName: string;
  businessDescription: string;
  businessUrl: string;
  repPhone: string;
}

export interface SpeakerOnboardingResult {
  ok: boolean;
  message?: string;
  /** Setup succeeded but some non-blocking writes failed — shown to the
      speaker before they head into the Studio. */
  warnings?: string[];
}

export async function completeSpeakerOnboarding(
  input: SpeakerOnboardingInput,
): Promise<SpeakerOnboardingResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in first." };

  const displayName = input.displayName.trim();
  // Every field is required before access is granted (Matt, 2026-08-12,
  // after a test speaker got a public page and Pro-level access with only a
  // name). Checked SERVER-side: the form's `required` attributes are a
  // convenience and are trivially bypassed.
  const missing = missingSpeakerFields({
    name: displayName,
    title: input.speakerTitle,
    bio: input.bio,
    industries: input.industries.split(","),
    businessName: input.businessName,
    businessDescription: input.businessDescription,
    businessUrl: input.businessUrl,
    phone: input.repPhone,
  });
  if (missing.length > 0) {
    return { ok: false, message: missingFieldsSentence(missing) };
  }

  const admin = createServiceClient();
  const { findOpenInvite } = await import("@/lib/invite-lookup");
  const invite = await findOpenInvite<{ id: string }>(
    admin,
    "speaker_invites",
    user,
  );
  /*
   * An open invite is the usual authorization. A speaker who is ALREADY set
   * up but whose profile predates this rule is the other: the Studio sends
   * them here to finish, and their existing speaker row is their authority.
   * Without this they would be bounced between a Studio that refuses them
   * and a form that says they were never invited.
   */
  let existingSpeakerId: string | null = null;
  if (!invite) {
    const { data: own } = await admin
      .from("speakers")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();
    existingSpeakerId = (own?.id as string) ?? null;
  }
  if (!invite && !existingSpeakerId) {
    return {
      ok: false,
      message:
        "We couldn't find a pending speaker invite for this account — ask the Momentum+ team to re-send yours.",
    };
  }

  const termEnd = seasonEnd().toISOString();
  const industries = input.industries
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Partial failures are REPORTED, not swallowed — a speaker whose resource
  // or profile write failed used to land in the Studio believing it saved.
  const warnings: string[] = [];

  // 1) Their business as a member resource (their single resource page).
  //    An existing speaker sent here to finish an incomplete profile already
  //    has one — update it rather than leaving a second, orphaned resource
  //    behind every time they save.
  let resourceId: string | null = null;
  if (existingSpeakerId) {
    const { data: own } = await admin
      .from("speakers")
      .select("resource_id")
      .eq("id", existingSpeakerId)
      .maybeSingle();
    resourceId = (own?.resource_id as string) ?? null;
  }
  if (resourceId) {
    const { error: updateError } = await admin
      .from("resources")
      .update({
        title: input.businessName.trim(),
        description: input.businessDescription.trim() || null,
        url: input.businessUrl.trim() || null,
        partner_name: displayName,
      })
      .eq("id", resourceId);
    if (updateError) {
      warnings.push(
        `Your business resource page didn't save (${updateError.message}) — you can edit it from your Speaker Studio.`,
      );
    }
  } else if (input.businessName.trim()) {
    const { data: resource, error: resourceError } = await admin
      .from("resources")
      .insert({
        title: input.businessName.trim(),
        category: "Speaker Business",
        description: input.businessDescription.trim() || null,
        url: input.businessUrl.trim() || null,
        partner_name: displayName,
        min_access: "all_members",
        active: true,
      })
      .select("id")
      .single();
    resourceId = (resource?.id as string) ?? null;
    if (resourceError || !resourceId) {
      warnings.push(
        `Your business resource page didn't save (${resourceError?.message ?? "unknown error"}) — you can add it from your Speaker Studio.`,
      );
    }
  }

  // 2) The speaker directory page (reuses an existing record if an admin
  //    already created one wired to this account).
  const { data: existingSpeaker } = await admin
    .from("speakers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  const speakerRow = {
    profile_id: user.id,
    name: displayName,
    title: input.speakerTitle.trim() || null,
    bio: input.bio.trim() || null,
    industries,
    expires_at: termEnd,
    archived_at: null,
    resource_id: resourceId,
  };
  let speakerId: string;
  if (existingSpeaker) {
    speakerId = existingSpeaker.id as string;
    const { error: updateError } = await admin
      .from("speakers")
      .update(speakerRow)
      .eq("id", speakerId);
    if (updateError) {
      return { ok: false, message: updateError.message };
    }
  } else {
    const { data: created, error } = await admin
      .from("speakers")
      .insert(speakerRow)
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, message: error?.message ?? "Couldn't save your speaker page." };
    }
    speakerId = created.id as string;
  }

  // 3) Personal profile.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: displayName,
      title: input.speakerTitle.trim() || null,
      phone: input.repPhone.trim() || null,
      company: input.businessName.trim() || null,
    })
    .eq("id", user.id);
  if (profileError) {
    warnings.push(
      `Your personal profile details didn't save (${profileError.message}) — update them under My Profile once you're in.`,
    );
  }

  // 4) Speaker-tier access (Pro-equivalent) through the season end.
  const { data: existingAccess } = await admin
    .from("memberships")
    .select("id")
    .eq("profile_id", user.id)
    .eq("source", "speaker")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let accessError: string | null = null;
  if (existingAccess) {
    const { error } = await admin
      .from("memberships")
      .update({ status: "active", access_expires_at: termEnd })
      .eq("id", existingAccess.id);
    accessError = error?.message ?? null;
  } else {
    const { error } = await admin.from("memberships").insert({
      profile_id: user.id,
      tier: "speaker",
      status: "active",
      access_starts_at: new Date().toISOString(),
      access_expires_at: termEnd,
      source: "speaker",
    });
    accessError = error?.message ?? null;
  }
  if (accessError) {
    // Leave the invite open so the speaker can retry once it's fixed —
    // without a membership row they'd be locked out of the portal.
    const hint = /membership_source/i.test(accessError)
      ? " (The team needs to apply database migration 0036.)"
      : "";
    return {
      ok: false,
      message: `Your speaker page saved, but portal access couldn't be set up: ${accessError}.${hint} Please try again or contact the Momentum+ team.`,
    };
  }

  // 5) Close the invite, when this was an invite rather than an existing
  //    speaker finishing a profile the Studio turned them away for.
  if (invite) {
    await admin
      .from("speaker_invites")
      .update({ completed_at: new Date().toISOString(), speaker_id: speakerId })
      .eq("id", invite.id);
  }
  revalidatePath("/speaker");

  revalidatePath("/speakers");
  revalidatePath("/resources");
  revalidatePath("/admin/speakers");
  updateTag("speakers");
  return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
}

export async function getPendingSpeakerInvite(): Promise<{
  pending: boolean;
  displayName?: string;
  needsPassword?: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { pending: true, displayName: "", needsPassword: true };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { pending: false };
  const { findOpenInvite } = await import("@/lib/invite-lookup");
  const invite = await findOpenInvite<{
    id: string;
    display_name: string | null;
    account_created: boolean | null;
  }>(
    createServiceClient(),
    "speaker_invites",
    user,
    "id, display_name, account_created",
  );
  if (invite) {
    return {
      pending: true,
      displayName: (invite.display_name as string) ?? "",
      needsPassword: Boolean(invite.account_created),
    };
  }

  /*
   * No invite, but an existing speaker the Studio turned away for an
   * incomplete profile still needs this form — it is the only place that
   * collects all of these fields in one pass. Their speaker row is the
   * authorization; completeSpeakerOnboarding checks for it too.
   */
  const { getSpeakerForUser, speakerProfileGaps } = await import(
    "@/lib/speaker-tools"
  );
  const speaker = await getSpeakerForUser(user.id);
  if (!speaker) return { pending: false };
  const gaps = await speakerProfileGaps(speaker, user.id);
  if (gaps.length === 0) return { pending: false };
  return { pending: true, displayName: speaker.name, needsPassword: false };
}
