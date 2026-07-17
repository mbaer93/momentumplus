"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { seasonEnd } from "@/lib/sponsor-lifecycle";

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
}

export async function completeSpeakerOnboarding(
  input: SpeakerOnboardingInput,
): Promise<SpeakerOnboardingResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Saved (preview mode)." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in first." };

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, message: "Tell us your name." };

  const admin = createServiceClient();
  const { data: invite } = await admin
    .from("speaker_invites")
    .select("id")
    .eq("invited_profile_id", user.id)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invite) {
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

  // 1) Their business as a member resource (their single resource page).
  let resourceId: string | null = null;
  if (input.businessName.trim()) {
    const { data: resource } = await admin
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
    await admin.from("speakers").update(speakerRow).eq("id", speakerId);
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
  await admin
    .from("profiles")
    .update({
      full_name: displayName,
      title: input.speakerTitle.trim() || null,
      phone: input.repPhone.trim() || null,
      company: input.businessName.trim() || null,
    })
    .eq("id", user.id);

  // 4) Speaker-tier access (Pro-equivalent) through the season end.
  const { data: existingAccess } = await admin
    .from("memberships")
    .select("id")
    .eq("profile_id", user.id)
    .eq("source", "speaker")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingAccess) {
    await admin
      .from("memberships")
      .update({ status: "active", access_expires_at: termEnd })
      .eq("id", existingAccess.id);
  } else {
    await admin.from("memberships").insert({
      profile_id: user.id,
      tier: "speaker",
      status: "active",
      access_starts_at: new Date().toISOString(),
      access_expires_at: termEnd,
      source: "speaker",
    });
  }

  // 5) Close the invite.
  await admin
    .from("speaker_invites")
    .update({ completed_at: new Date().toISOString(), speaker_id: speakerId })
    .eq("id", invite.id);

  revalidatePath("/speakers");
  revalidatePath("/resources");
  revalidatePath("/admin/speakers");
  revalidateTag("speakers");
  return { ok: true };
}

export async function getPendingSpeakerInvite(): Promise<{
  pending: boolean;
  displayName?: string;
  needsPassword?: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { pending: true, displayName: "", needsPassword: true };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { pending: false };
  const { data: invite } = await createServiceClient()
    .from("speaker_invites")
    .select("display_name, account_created")
    .eq("invited_profile_id", user.id)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invite) return { pending: false };
  return {
    pending: true,
    displayName: (invite.display_name as string) ?? "",
    needsPassword: Boolean(invite.account_created),
  };
}
