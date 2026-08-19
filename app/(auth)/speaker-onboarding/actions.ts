"use server";

import { revalidatePath, updateTag } from "next/cache";
import { emailPattern } from "@/lib/db-utils";
import { hasPassword } from "@/lib/has-password";
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

interface OwnedSpeakerRow {
  id: string;
  resourceId: string | null;
  /** True when the row is already wired to this account, false when it is an
      unclaimed listing matched only by email. Authorization reads this. */
  linkedToProfile: boolean;
}

/**
 * The speaker row this account already owns, by profile id first and then by
 * an UNCLAIMED listing carrying the same contact email.
 *
 * `order(...).limit(1)` rather than `maybeSingle()` on the email lookup:
 * maybeSingle treats two matches as an error and returns nothing, which here
 * would mean "no listing found" and mint a third row for a person who already
 * had two. Oldest first, so repeated runs converge on the same row instead of
 * ping-ponging between them.
 */
async function findOwnSpeaker(
  admin: ReturnType<typeof createServiceClient>,
  user: { id: string; email?: string | null },
): Promise<OwnedSpeakerRow | null> {
  const { data: own } = await admin
    .from("speakers")
    .select("id, resource_id")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (own) {
    return {
      id: own.id as string,
      resourceId: (own.resource_id as string | null) ?? null,
      linkedToProfile: true,
    };
  }
  if (!user.email) return null;
  const { data: byEmail } = await admin
    .from("speakers")
    .select("id, resource_id")
    .ilike("contact_email", emailPattern(user.email))
    .is("profile_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!byEmail) return null;
  return {
    id: byEmail.id as string,
    resourceId: (byEmail.resource_id as string | null) ?? null,
    linkedToProfile: false,
  };
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
  /*
   * Validation runs BEFORE the preview short-circuit, deliberately.
   *
   * With it below, a credential-free preview accepted anything and returned
   * "Saved" — which is the environment the e2e suite runs in, so the one
   * gate protecting speaker access was the one thing the tests could not
   * reach. A preview that disagrees with production about what is valid is
   * not a preview of production.
   */
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

  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in first." };

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
  /*
   * Which speaker row this person already owns — resolved ONCE, before
   * anything is written, because both the authorization check below and the
   * business-resource write further down need the answer.
   *
   * Matching on profile_id alone was not enough. A listing pulled from TSLS
   * has no profile_id until someone links it, and the plain "invite a
   * speaker" form (as opposed to the per-listing invite button) never links
   * it. So Sierra onboarded and got a brand-new "Sierra C." row alongside the
   * "Sierra Collins" listing she already had — two records, one person, and
   * the name-based duplicate finder cannot spot that pair because the names
   * normalise differently (Matt, 2026-08-14).
   *
   * Same profile-id-OR-email rule the invite lookup already uses, for the
   * same reason: two readers keyed differently is how people end up
   * duplicated or locked out. Unclaimed listings only — a row already wired
   * to a DIFFERENT account is somebody else's, and taking it over would be
   * worse than a duplicate.
   */
  const ownedSpeaker = await findOwnSpeaker(admin, user);
  const existingSpeakerId = ownedSpeaker?.id ?? null;
  /*
   * Three ways to be entitled to this form:
   *
   * 1. an open invite;
   * 2. a speaker row already linked to THIS account (the Studio sends an
   *    existing speaker here to finish a profile that predates the
   *    completeness rule);
   * 3. an UNCLAIMED listing carrying this account's verified email address
   *    (Matt, 2026-08-14).
   *
   * The third is a deliberate widening. It means a speaker whose invite went
   * astray — bounced, spam-filtered, sent to the wrong address, completed by
   * a since-deleted account — can still get in, instead of waiting on an
   * admin to notice. What it does NOT do is let anyone claim a listing that
   * belongs to someone else: findOwnSpeaker only matches rows with a null
   * profile_id, and the email comes from the Supabase session, so it is one
   * this person has actually proven they control.
   *
   * Logged, because this path grants speaker access without an admin
   * involved and an unexplained speaker is worse than a noisy log. Ids only
   * — an email address is personal data and this is a log line.
   */
  if (!invite && ownedSpeaker && !ownedSpeaker.linkedToProfile) {
    console.info(
      `[speaker-onboarding] profile ${user.id} claimed unclaimed listing ${ownedSpeaker.id} by verified email, with no open invite`,
    );
  }
  if (!invite && !ownedSpeaker) {
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
  //    Whichever row they already own — linked account or claimed listing —
  //    its resource is UPDATED rather than replaced. Reading this only for
  //    the account-linked case used to strand the old resource: a claimed
  //    listing's business page stayed published with nothing pointing at it,
  //    and the speaker got a second one.
  let resourceId: string | null = ownedSpeaker?.resourceId ?? null;
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

  // 2) The speaker directory page — writing into the row resolved above
  //    (see findOwnSpeaker) rather than creating a second record.
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
  if (existingSpeakerId) {
    speakerId = existingSpeakerId;
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

  /*
   * 5) Close EVERY open invite for this person, not just the one that
   *    authorized them.
   *
   *    Closing only `invite` left rows open whenever setup was authorized by
   *    something else — an existing speaker row, or (since #229) an
   *    unclaimed listing matching their verified email. It also missed the
   *    case of an invite whose email differs from the account they signed in
   *    with, and any second invite an admin re-sent while they were mid-form.
   *
   *    The visible symptom is Admin → Speakers listing someone under
   *    "Waiting on" who finished their setup days ago (Matt, 2026-08-15),
   *    which makes the one screen tracking speaker onboarding untrustworthy
   *    — you cannot tell who genuinely hasn't started.
   *
   *    Matched the same two ways every other invite reader matches: the
   *    account id, and the email.
   */
  const closedAt = new Date().toISOString();
  const closeInvite = (column: "invited_profile_id" | "email", value: string) =>
    column === "email"
      ? admin
          .from("speaker_invites")
          .update({ completed_at: closedAt, speaker_id: speakerId })
          .is("completed_at", null)
          .ilike("email", emailPattern(value))
      : admin
          .from("speaker_invites")
          .update({ completed_at: closedAt, speaker_id: speakerId })
          .is("completed_at", null)
          .eq("invited_profile_id", value);

  const closes = [closeInvite("invited_profile_id", user.id)];
  if (user.email) closes.push(closeInvite("email", user.email));
  const closeResults = await Promise.all(closes);
  const closeError = closeResults.find((r) => r.error)?.error;
  if (closeError) {
    // Their access is already granted, so this must not fail the setup —
    // but an admin chasing a completed speaker is exactly the confusion
    // this step exists to prevent, so say so.
    warnings.push(
      `Your invite is still showing as outstanding to the Momentum+ team (${closeError.message}) — you're fully set up; they can clear it.`,
    );
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
      /*
       * account_created says WE made the account; it does not say they
       * still lack a password. Rob set one through a recovery link and was
       * asked for another on the next screen (2026-08-19).
       */
      needsPassword:
        Boolean(invite.account_created) && !(await hasPassword(user.id)),
    };
  }

  /*
   * No invite. Two other people belong here, and this page has to recognise
   * BOTH — the same rule completeSpeakerOnboarding applies, or the form
   * refuses someone the action would have accepted (or the reverse, which is
   * how the last dead end happened).
   */
  const admin = createServiceClient();
  const owned = await findOwnSpeaker(admin, user);
  if (!owned) return { pending: false };

  const { getSpeakerForUser, speakerProfileGaps } = await import(
    "@/lib/speaker-tools"
  );
  if (!owned.linkedToProfile) {
    /*
     * An unclaimed listing matching this account's verified email. Nothing is
     * linked yet, so there is always something to do here — at minimum the
     * business page and phone the listing has never carried. Seed the name
     * from the listing so they aren't retyping what we already show publicly.
     */
    const { data: listing } = await admin
      .from("speakers")
      .select("name")
      .eq("id", owned.id)
      .maybeSingle();
    return {
      pending: true,
      displayName: (listing?.name as string) ?? "",
      needsPassword: false,
    };
  }

  // An existing speaker the Studio turned away for an incomplete profile.
  // This form is the only place that collects all of these fields in one pass.
  const speaker = await getSpeakerForUser(user.id);
  if (!speaker) return { pending: false };
  const gaps = await speakerProfileGaps(speaker, user.id);
  if (gaps.length === 0) return { pending: false };
  return { pending: true, displayName: speaker.name, needsPassword: false };
}
